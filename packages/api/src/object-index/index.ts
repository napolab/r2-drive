import { and, asc, count as countRows, eq, gt, ne } from 'drizzle-orm';

import { BucketMismatchError } from './errors';
import { keyPartsOf } from './key-parts/index';
import { meta, objects, prefixes } from './schema';
import { SqliteStore } from './sqlite-store';

import type { FolderDescriptor, NextPage, ObjectDescriptor, ObjectPage } from '@r2-drive/core';
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

// 1 バケット = 1 DO の不変条件を DO 側に焼き付けるための meta キー。
export const BUCKET_ID_KEY = 'bucket_id';

// db.transaction() のコールバックが受け取る tx。Drizzle は型名を公開していないので
// database 型から引き出す。
type Tx = Parameters<Parameters<DrizzleSqliteDODatabase<Record<string, never>>['transaction']>[0]>[0];

// prefix('a/b/') の親 prefix は、末尾の '/' を落としたキーの親と同じ。
const parentPrefixOf = (prefix: string): string => keyPartsOf(prefix.slice(0, -1)).parentPrefix;

// cursor は「最後に返した key」。R2 の opaque token と役割が同じなので
// ワイヤ型 NextPage は変わらない(spec §6)。bucketId は誤ルーティング検出の guard
// (meta.bucket_id)とは別物で、list が返す ObjectDescriptor / FolderDescriptor の
// bucketId は引き続きこの入力から取る(Ruling 11。meta からは読まない)。
export type IndexListInput = {
  readonly bucketId: string;
  readonly prefix: string;
  readonly cursor: string | undefined;
  readonly limit: number;
};

// bucketId は list と同じく guard(meta.bucket_id)ではなく引数が出典(Ruling 11)。
export type IndexSearchInput = {
  readonly bucketId: string;
  readonly query: string;
  readonly cursor: string | undefined;
  readonly limit: number;
};

// objects_fts と objects を JOIN した raw sql.exec の行形。列名は schema.ts の
// 手書き DDL(snake_case)に従う。Drizzle の $inferSelect(camelCase)とは別物。
type ObjectRow = {
  readonly key: string;
  readonly name: string;
  readonly content_type: string;
  readonly size: number;
  readonly uploaded_at: string;
  readonly etag: string;
};

export class ObjectIndex extends SqliteStore {
  // objects / prefixes / meta は Drizzle で、objects_fts(FTS5 の仮想テーブル。Drizzle では
  // 表現できない)は raw sql.exec で書く。両方を db.transaction() の中に置くことで
  // 同一トランザクションに乗せる。Drizzle の db.transaction() は durable-sqlite では
  // ctx.storage.transactionSync() に直接委譲しているので、raw sql.exec も同じ
  // トランザクションに入る。
  //
  // 明示的に囲う理由(Task 2 の実測、2026-08-17、miniflare 上): 連続した sql.exec は、
  // 失敗した文の直前までをロールバックしない。失敗が prepare 段階か実行時かにも、
  // 例外を捕まえるかどうかにも依存しない。囲わないと 2 行残り、transactionSync で
  // 囲うと 1 行に戻ることを対照実験で確認している(test/sql-exec-atomicity.test.ts)。
  // なお Cloudflare の言う write coalescing は耐久性のバッチング(output gate)の話で、
  // 文の失敗によるロールバックは元々そこに含まれていない。
  //
  // object.name は保存しない。name は key から一意に決まる派生値なので、
  // keyPartsOf(key).name を唯一の出典にする(呼び出し側が矛盾した name を渡しても
  // 索引は key に従う)。
  upsert(object: ObjectDescriptor): void {
    const { name, parentPrefix, ancestorPrefixes } = keyPartsOf(object.key);
    const updates = {
      name,
      parentPrefix,
      contentType: object.contentType,
      size: object.size,
      uploadedAt: object.uploadedAt,
      etag: object.etag,
    };

    this.db.transaction((tx) => {
      this.#bindBucket(tx, object.bucketId);
      tx.insert(objects)
        .values({ key: object.key, ...updates })
        .onConflictDoUpdate({ target: objects.key, set: updates })
        .run();
      // FTS5 は UPSERT を持たないので、消してから入れる。
      this.ctx.storage.sql.exec(`DELETE FROM objects_fts WHERE key = ?`, object.key);
      this.ctx.storage.sql.exec(`INSERT INTO objects_fts (key, name) VALUES (?, ?)`, object.key, name);
      for (const prefix of ancestorPrefixes) {
        tx.insert(prefixes)
          .values({ prefix, parentPrefix: parentPrefixOf(prefix) })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  // prefixes 行は消さない。空フォルダを表現しない方針(spec §4)なので、中身が消えた
  // フォルダは一覧に出なければよい。ここで消さない代わりに、補償は Task 5 の一覧側で
  // 「その prefix 配下に objects が 1 件でも存在するか」を EXISTS で確認して行う。
  // つまり prefixes に残る行は幽霊フォルダのバグではなく、読み取り側で潰す前提の残骸である。
  remove(key: string): void {
    this.db.transaction((tx) => {
      tx.delete(objects).where(eq(objects.key, key)).run();
      this.ctx.storage.sql.exec(`DELETE FROM objects_fts WHERE key = ?`, key);
    });
  }

  count(): number {
    // countRows は drizzle-orm の count()。このメソッド名と紛れるので別名で入れている。
    const row = this.db.select({ total: countRows() }).from(objects).get();

    // COUNT(*) は必ず 1 行返るので ?? 0 は到達しない。noUncheckedIndexedAccess ではなく
    // Drizzle の get() が T | undefined を返す型都合のための既定値である。
    return row?.total ?? 0;
  }

  // objects の読み取りは Drizzle で書く(Task 4 で確立した方針)。limit + 1 件取って、
  // 余ったら truncated と判定する(COUNT を撃たずに済む)。
  //
  // key === prefix の行(末尾 '/' の 0 バイトフォルダマーカー。R2 に実在し、多くの
  // ツールが作る)は除外する。packages/api/src/r2/list.ts の listObjects が同じ理由
  // (「prefix そのものを表す 0 バイトのマーカーは一覧に出さない」)で
  // `.filter((object) => object.key !== input.prefix)` しているのと同じ挙動に揃える
  // (Ruling 14)。揃えないと indexed の有無で一覧の中身が変わり、名前が空のエントリが出る。
  list(input: IndexListInput): ObjectPage {
    const where =
      input.cursor === undefined
        ? and(eq(objects.parentPrefix, input.prefix), ne(objects.key, input.prefix))
        : and(eq(objects.parentPrefix, input.prefix), ne(objects.key, input.prefix), gt(objects.key, input.cursor));

    const rows = this.db
      .select()
      .from(objects)
      .where(where)
      .orderBy(asc(objects.key))
      .limit(input.limit + 1)
      .all();

    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const next: NextPage = rows.length > input.limit && last !== undefined ? { kind: 'more', cursor: last.key } : { kind: 'end' };

    return {
      // フォルダは 1 ページ目だけで出し切る。R2 の delimitedPrefixes もカーソルを
      // またいで重複しないので、挙動を合わせる。
      folders: input.cursor === undefined ? this.#foldersOf(input.bucketId, input.prefix) : [],
      objects: page.map((row) => ({
        bucketId: input.bucketId,
        key: row.key,
        name: row.name,
        contentType: row.contentType,
        size: row.size,
        uploadedAt: row.uploadedAt,
        etag: row.etag,
      })),
      next,
    };
  }

  // remove は prefixes 行を消さない(上の remove のコメント参照)。中身が全部消えた
  // フォルダが prefixes に残ったままだと幽霊フォルダとして一覧に出てしまうため、
  // ここで「配下に objects が 1 件でも存在するか」を EXISTS で確認してから返す
  // (Ruling 2)。R2 経路(delimitedPrefixes)にはこの現象が存在しないので、
  // indexed の有無で挙動が変わらないようにする。
  //
  // 上界は LIKE ではなく範囲比較で作る(LIKE はパターン長 50 バイト上限を持ち、
  // '%' のエスケープも要る)。prefixes.prefix は keyPartsOf の設計上、必ず末尾が
  // '/'(0x2F)で終わる。末尾を次のコードポイント '0'(0x30)に置き換えた文字列が
  // 排他的上界になる(SQLite の TEXT 比較は既定で BINARY = バイト列比較なので、
  // 'a/b/' 配下の任意の key は必ず 'a/b0' より小さく、'a/b0' 以降の兄弟 prefix とは
  // 重ならない)。objects.key は PRIMARY KEY なので、この EXISTS は範囲スキャンで
  // 索引に乗る。
  //
  // 相関 EXISTS + 文字列演算は Drizzle のクエリビルダで素直に表現できないので
  // raw sql.exec で書く(objects/prefixes 単体の読み取りは list() 本体・count() で
  // Drizzle を使っている)。
  //
  // EXISTS の対象からも objects.key = prefixes.prefix(0 バイトのフォルダマーカー自身)
  // を除く。list() 側と同じ Ruling 14 の対応で、除かないと「自分のマーカーだけを含む
  // フォルダ」が非空と誤判定され、開くと空になる(Ruling 2 で潰した幽霊フォルダと
  // 同種の乖離)。list() 本体の `ne(objects.key, input.prefix)` と対にして直すこと。
  #foldersOf(bucketId: string, prefix: string): readonly FolderDescriptor[] {
    return this.ctx.storage.sql
      .exec<{ prefix: string }>(
        `SELECT prefix FROM prefixes
         WHERE parent_prefix = ?
           AND EXISTS (
             SELECT 1 FROM objects
             WHERE objects.key >= prefixes.prefix
               AND objects.key < substr(prefixes.prefix, 1, length(prefixes.prefix) - 1) || '0'
               AND objects.key <> prefixes.prefix
           )
         ORDER BY prefix`,
        prefix,
      )
      .toArray()
      .map((row) => ({ bucketId, prefix: row.prefix, name: keyPartsOf(row.prefix.slice(0, -1)).name }));
  }

  // FTS5 のクエリ構文をユーザー入力に露出させない。二重引用符を潰してフレーズとして
  // 囲み、末尾に * を付けて前方一致にする。こうしないと 'a OR "b' のような入力が
  // 構文エラーで例外になる(消費エッジで拾わず DO の RPC 越しに投げてしまう)。
  #ftsQueryOf(raw: string): string {
    const sanitized = raw.replaceAll('"', ' ').trim();

    return sanitized === '' ? '""' : `"${sanitized}"*`;
  }

  // objects_fts(FTS5 の仮想テーブル)は Drizzle で表現できないので raw sql.exec で
  // 書く(list() 本体は objects 単体の読み取りなので Drizzle、こちらは
  // objects_fts と objects の JOIN なので raw、という使い分けは #foldersOf と同じ)。
  //
  // 順序は key 昇順にする。rank(一致度)順にすると同じ query でもページ間で順序が
  // 安定せず、cursor の意味が壊れる(「最後に返した key より後ろ」が成り立たなくなり、
  // 取りこぼしや重複が起きる)。R2 の cursor と同じ「最後に返した key」という契約を
  // 守るため、rank ではなく key で決定的に並べる。
  //
  // key === prefix の 0 バイトフォルダマーカー(末尾 '/' のキー)は list() と同じ
  // 理由(Ruling 14 / Ruling 15)で除外する。マーカーは name が空文字だが、name が
  // 空になる条件は他にもありうるので、判定はマーカーの定義そのもの(key が末尾 '/' で
  // 終わる)に置く。除外しないと「一覧では見えないが検索では見える」非対称が生まれ、
  // 検索結果から開けないオブジェクトが出る。
  search(input: IndexSearchInput): ObjectPage {
    const sql = this.ctx.storage.sql;
    const match = this.#ftsQueryOf(input.query);
    const rows =
      input.cursor === undefined
        ? sql
            .exec<ObjectRow>(
              `SELECT o.* FROM objects_fts f JOIN objects o ON o.key = f.key
               WHERE f.objects_fts MATCH ? AND o.key NOT LIKE '%/'
               ORDER BY o.key LIMIT ?`,
              match,
              input.limit + 1,
            )
            .toArray()
        : sql
            .exec<ObjectRow>(
              `SELECT o.* FROM objects_fts f JOIN objects o ON o.key = f.key
               WHERE f.objects_fts MATCH ? AND o.key NOT LIKE '%/' AND o.key > ?
               ORDER BY o.key LIMIT ?`,
              match,
              input.cursor,
              input.limit + 1,
            )
            .toArray();

    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const next: NextPage = rows.length > input.limit && last !== undefined ? { kind: 'more', cursor: last.key } : { kind: 'end' };

    return {
      // 検索結果に階層構造は無い。
      folders: [],
      objects: page.map((row) => ({
        bucketId: input.bucketId,
        key: row.key,
        name: row.name,
        contentType: row.content_type,
        size: row.size,
        uploadedAt: row.uploaded_at,
        etag: row.etag,
      })),
      next,
    };
  }

  // 1 バケット = 1 DO は idFromName(bucketId) を呼ぶ側の不変条件にすぎず、DO 自身は
  // 誰が入れたかを知らない。初回 upsert で bucket_id を meta に焼き、以降は不一致を
  // 例外にする。誤ルーティングで索引が静かに混ざるのが最悪の失敗モードなので、
  // 静かに成功させない(Ruling 11)。
  //
  // meta は guard であって source ではない。list / search が返す bucketId の出所は
  // 引き続き呼び出し側の引数である(ワイヤ互換とページング設計を変えないため)。
  #bindBucket(tx: Tx, bucketId: string): void {
    const bound = tx.select({ v: meta.v }).from(meta).where(eq(meta.k, BUCKET_ID_KEY)).get();

    if (bound === undefined) {
      tx.insert(meta).values({ k: BUCKET_ID_KEY, v: bucketId }).run();

      return;
    }
    if (bound.v !== bucketId) throw new BucketMismatchError(`${bound.v}`, bucketId);
  }
}
