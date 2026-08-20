import { and, asc, count as countRows, eq, gt, ne } from 'drizzle-orm';

import { contentTypeOf } from '../r2/list';
import { resolveBucket } from '../r2/registry';

import { listCursor, searchCursor } from './cursor/index';
import { BucketMismatchError } from './errors';
import { keyPartsOf } from './key-parts/index';
import { backfillTombstones, meta, objects, prefixes } from './schema';
import { SqliteStore } from './sqlite-store';

import type { BackfillStatus } from './status';
import type { FolderDescriptor, NextPage, ObjectDescriptor, ObjectPage } from '@r2-drive/core';
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

// 1 バケット = 1 DO の不変条件を DO 側に焼き付けるための meta キー。
export const BUCKET_ID_KEY = 'bucket_id';

// バックフィルの状態は meta 表に置く。BUCKET_ID_KEY(Ruling 11 の誤ルーティング検出)と
// 同じ表を共有するので、キー名を backfill_ で名前空間化して衝突を避ける。
// **meta を一括クリアする操作を書かないこと。**bucket_id ごと消えると guard が静かに
// 無効になり、誤ルーティングした upsert が通ってしまう。触るときは必ずキー単位で触る。
const BACKFILL_STATE_KEY = 'backfill_state';
const BACKFILL_CURSOR_KEY = 'backfill_cursor';
const BACKFILL_BUCKET_ID_KEY = 'backfill_bucket_id';
const BACKFILL_REASON_KEY = 'backfill_reason';

// 処理したページ数。運用上の意味は「何往復かかったか」だが、主目的は Ruling 20 の
// 計器である。「include: ['httpMetadata'] を付けない = 1 ページ 1000 件」は速度にしか
// 現れないため、テストからは最終状態に痕跡が残らないと張れない(alarm は自動発火する
// ので途中経過は決定的に観測できない。test/wait-for-backfill.ts の実測参照)。
// ページ数なら最終状態として残るので競合しない。include を付け直すと同じデータで
// ページ数が 10 倍に跳ね、BACKFILL_PAGE を縮めても跳ねる。
export const BACKFILL_PAGES_KEY = 'backfill_pages';

// R2 の list の 1 ページ分。R2 側の上限が 1000 なのでそれに合わせる。
//
// 実測(2026-08-18、miniflare 上、1005 件を置いたバケット): include を付けない
// list({ limit: 1000 }) は 1000 件返し、include: ['httpMetadata'] を付けると R2 が
// レスポンス全体のデータ量で打ち切って 100 件に丸める(r2/list.ts の同じ実測と一致)。
//
// Ruling 20: 索引に書く contentType は contentTypeOf(key)(拡張子由来)なので
// httpMetadata は要らない。include を付けないことがそのまま往復数 10 分の 1 になる。
const BACKFILL_PAGE = 1000;

// db.transaction() のコールバックが受け取る tx。Drizzle は型名を公開していないので
// database 型から引き出す。
type Tx = Parameters<Parameters<DrizzleSqliteDODatabase<Record<string, never>>['transaction']>[0]>[0];

// prefix('a/b/') の親 prefix は、末尾の '/' を落としたキーの親と同じ。
const parentPrefixOf = (prefix: string): string => keyPartsOf(prefix.slice(0, -1)).parentPrefix;

// cursor は「最後に返した key」に経路タグを前置したもの(Ruling 18。cursor/index.ts)。
// R2 の opaque token と役割が同じでクライアントからは opaque なままなので、
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
      this.#tombstoneIfBackfillRunning(tx, key);
    });
  }

  // バックフィル走行中(meta.backfill_state === 'running')の remove だけトゥームストーンを
  // 書く(I3)。#indexPage の `bucket.list()` スナップショットは呼び出し時点の R2 の
  // 状態なので、その窓の間に届いた live remove は「消したはずのキーがまだリストに載って
  // いる」状態を作る。トゥームストーンはその目印であり、#backfillUpsert がこれを見て
  // 再挿入をスキップする。remove の呼び出しトランザクションの中で行うことで、削除と
  // トゥームストーンの書き込みを不可分にする(走行中でない remove はここで何もしない
  // ので、通常の削除経路にオーバーヘッドを足さない)。
  #tombstoneIfBackfillRunning(tx: Tx, key: string): void {
    const state = tx.select({ v: meta.v }).from(meta).where(eq(meta.k, BACKFILL_STATE_KEY)).get()?.v;

    if (state !== 'running') return;
    tx.insert(backfillTombstones).values({ key }).onConflictDoNothing().run();
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
  //
  // cursor は listCursor で往復させる。タグが無い / 別経路のタグが付いた cursor は
  // ForeignCursorError を投げて弾く(Ruling 18)。**沈黙して先頭から返さないこと。**
  // 重複したページが出るだけで、利用者は間違いに気付けない。
  list(input: IndexListInput): ObjectPage {
    const after = input.cursor === undefined ? undefined : listCursor.decode(input.cursor);
    const where =
      after === undefined
        ? and(eq(objects.parentPrefix, input.prefix), ne(objects.key, input.prefix))
        : and(eq(objects.parentPrefix, input.prefix), ne(objects.key, input.prefix), gt(objects.key, after));

    const rows = this.db
      .select()
      .from(objects)
      .where(where)
      .orderBy(asc(objects.key))
      .limit(input.limit + 1)
      .all();

    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const next: NextPage = rows.length > input.limit && last !== undefined ? { kind: 'more', cursor: listCursor.encode(last.key) } : { kind: 'end' };

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
  //
  // この EXISTS が、R2 経路との意図的な非対称(Ruling 24)を生む震源でもある: マーカー
  // しか無いフォルダは EXISTS が偽になり一覧に出ないが、R2 の delimitedPrefixes は
  // マーカーの有無を見ずに機械的にフォルダを作るのでここでは出る。修正対象ではない
  // (test/folder-marker-asymmetry.integration.test.ts のコメント参照)。
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
  //
  // cursor は searchCursor で往復させる(Ruling 18)。list とはタグが違うので、
  // 一覧の cursor を検索に渡す / その逆も弾ける。検索は prefix を持たないため、
  // 取り違えると別フォルダのキーを起点に走査して静かに間違う。
  search(input: IndexSearchInput): ObjectPage {
    const sql = this.ctx.storage.sql;
    const match = this.#ftsQueryOf(input.query);
    const after = input.cursor === undefined ? undefined : searchCursor.decode(input.cursor);
    const rows =
      after === undefined
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
              after,
              input.limit + 1,
            )
            .toArray();

    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const next: NextPage = rows.length > input.limit && last !== undefined ? { kind: 'more', cursor: searchCursor.encode(last.key) } : { kind: 'end' };

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

  // 索引の現在の状態を返す。副作用は無い。運用の口(GET /buckets/:id/index/status)の出典。
  //
  // indexed は count()(索引の総行数)であって「今回のバックフィルが入れた件数」ではない。
  // upsert が冪等なので 2 回目は 0 件更新でも索引は正しく、運用者が知りたいのは
  // 「R2 の件数に追いついたか」だけである。
  status(): BackfillStatus {
    const state = this.#metaGet(BACKFILL_STATE_KEY);

    switch (state) {
      case 'running':
        return { kind: 'running', indexed: this.count() };
      case 'complete':
        return { kind: 'complete', indexed: this.count() };
      case 'failed':
        return { kind: 'failed', indexed: this.count(), reason: this.#metaGet(BACKFILL_REASON_KEY) ?? 'unknown' };
      default:
        return { kind: 'idle' };
    }
  }

  // 何度呼んでも安全。upsert が冪等なので、完了後に再実行しても行は増えず、
  // 「R2 にあるが索引に無い」オブジェクトだけが増える。これが uploads/index.ts の
  // multipart complete が約束している回復手段そのものである(同ファイルのコメント参照)。
  //
  // 走行中に呼ばれたらカーソルを先頭に戻して最初からやり直す。すでに入っている行を
  // 舐め直すだけで害は無く、「取りこぼしを作らない」側に倒す。
  //
  // setAlarm は await する。同期メソッドにして void で捨てると、予約が失敗しても
  // 気付けないまま running のまま止まる。
  //
  // Ruling 22: 戻り値は「遷移の結果としての状態」であって別クエリではない。
  // .claude/rules/design-principles.md の CQS からの意図的な逸脱であり、理由は
  // 202 Accepted のボディをそのまま返すのに DO への往復を 2 回にしないため。
  // query 側(status())は純粋なままに保つこと。
  //
  // failed からもここで復帰する。reason を消して running に戻すだけでよい
  // (原因を直してから叩き直す、が運用手順)。
  //
  // 走行中に叩くと、in-flight の alarm(#indexPage が await bucket.list() の途中)が
  // 完了時に `#metaSet(BACKFILL_CURSOR_KEY, listed.cursor)` を書き、ここで行った
  // カーソルのクリアを上書きしうる(最終レビュー I4)。`backfill_pages` のカウンタも
  // そのぶんずれる。最終状態は upsert が冪等なので揃うが、状態機械の記述(「叩き直すと
  // 先頭に戻る」)と実装がこの競合ウィンドウでは食い違う。
  async startBackfill(bucketId: string): Promise<BackfillStatus> {
    this.#metaSet(BACKFILL_BUCKET_ID_KEY, bucketId);
    this.#metaClear(BACKFILL_CURSOR_KEY);
    this.#metaClear(BACKFILL_REASON_KEY);
    this.#metaSet(BACKFILL_PAGES_KEY, '0');
    // backfill_tombstones は meta と違い bucket_id を同居させていないので一括クリアしてよい
    // (I3)。前回の走行の残骸を持ち越すと、今回の走行で有効な行まで永遠にスキップされる。
    this.db.delete(backfillTombstones).run();
    this.#metaSet(BACKFILL_STATE_KEY, 'running');
    await this.ctx.storage.setAlarm(Date.now());

    return this.status();
  }

  // alarm は at-least-once で配送され、ハンドラが失敗すると指数バックオフ(初回 2s)で
  // 最大 6 回まで再実行される。6 回で尽きた後は何の記録も残らないので、**失敗は自分で
  // 状態に記録して止める。**そうしないと「静かに途中で終わった索引」が残る。
  //
  // 1 回の alarm で 1 ページだけ処理し、続きがあれば次の alarm を予約する。10,000 件を
  // 1 回の alarm に押し込まないためと、途中で落ちてもカーソル位置から再開できるため。
  override async alarm(): Promise<void> {
    // **状態で弾くこと。**backfill_bucket_id は complete / failed の後も消さない
    // (どのバケットを索引したかの記録として意味があり、次の startBackfill が上書きする)
    // ので、「出典があるか」では迷い alarm を弾けない。
    //
    // 弾かないと 2 つ壊れる: (1) 終わったバックフィルがバケット全体を無駄に再スキャンする、
    // (2) **failed が静かに complete へ上書きされうる。**後者は「索引を信じてよいか」の
    // 判断を誤らせるので深刻である(indexed: true への切り替えは status を見て決める)。
    //
    // startBackfill は setAlarm より前に running を書くので、この順序は安全である。
    if (this.#metaGet(BACKFILL_STATE_KEY) !== 'running') return;

    const bucketId = this.#metaGet(BACKFILL_BUCKET_ID_KEY);
    // running なら startBackfill が必ず書いている。型の都合で残す guard。
    if (bucketId === undefined) return;

    // alarm は消費エッジなので、ここで Result を畳んでよい。
    return resolveBucket(this.env, bucketId).match(
      async (bucket) => this.#indexPage(bucketId, bucket),
      // バケット定義や binding が消えている場合。リトライしても回復しないので即座に止める。
      async (error) => this.#markFailed(`${error.name}: ${error.message}`),
    );
  }

  // 1 ページ分を索引に入れる。続きがあればカーソルを保存してから次の alarm を予約する。
  // **カーソルを保存しないと毎回先頭 1000 件を舐め直して永久に終わらない。**
  async #indexPage(bucketId: string, bucket: R2Bucket): Promise<void> {
    const cursor = this.#metaGet(BACKFILL_CURSOR_KEY);

    try {
      const listed = await this.listBackfillPage(bucket, cursor);
      for (const object of listed.objects) this.#indexObject(bucketId, object);
      this.#bumpPages();

      if (listed.truncated) {
        this.#metaSet(BACKFILL_CURSOR_KEY, listed.cursor);
        await this.ctx.storage.setAlarm(Date.now());

        return;
      }
      this.#metaClear(BACKFILL_CURSOR_KEY);
      // 完了したのでトゥームストーンはもう要らない(I3)。次回の startBackfill を待たず
      // ここで消すことで、完了後の remove が「もう走っていないバックフィルのための
      // トゥームストーン」を書かないのと対称にする。
      this.db.delete(backfillTombstones).run();
      this.#metaSet(BACKFILL_STATE_KEY, 'complete');
    } catch (cause) {
      this.#markFailed(cause instanceof Error ? `${cause.name}: ${cause.message}` : `${cause}`);
    }
  }

  // R2 の list を叩く箇所を 1 つに切り出したもの。ここが await の間だけ DO の入力ゲートが
  // 開き、live な remove() / upsert() が割り込める窓になる(I3)。protected にしているのは
  // テストからこの窓を決定的に作るための seam であり、production の分岐ではない
  // (test/worker-entry.ts の ObjectIndexUnderTest が override してスナップショット取得
  // 直後に割り込み操作を挟む)。
  //
  // include: ['httpMetadata'] は付けない(Ruling 20。BACKFILL_PAGE のコメント参照)。
  // prefix / delimiter も付けない。バックフィルはバケット全体を平坦に舐める。
  //
  // exactOptionalPropertyTypes 下では cursor: undefined を明示的に渡せないので、
  // キー自体を spread の有無で作る(r2/list.ts の listOptionsOf と同じ書き方)。
  protected async listBackfillPage(bucket: R2Bucket, cursor: string | undefined): Promise<R2Objects> {
    return bucket.list({ limit: BACKFILL_PAGE, ...(cursor === undefined ? {} : { cursor }) });
  }

  // Ruling 21: 0 バイトのフォルダマーカー(末尾 '/' のキー)も除外せず入れる。索引は
  // R2 の現在状態を映すものであり、マーカーが R2 に実在する以上、索引に行があるのが
  // 正しい。表示側は list(Ruling 14)と search(Ruling 15)が既に除外しているので
  // 利用者には見えない。マーカーを入れると ancestorPrefixes 経由で prefixes 行も
  // 作られるが、そのフォルダは実在するのでこれも正しい。
  //
  // 全フィールドが r2/list.ts の listObjects と同じ導出であること(Phase 0 との整合)。
  // 特に contentType は同じ contentTypeOf(key) を通す(Ruling 16)。ここだけ
  // httpMetadata を見ると、同じキーが indexed の有無で違う contentType を返す。
  //
  // name は upsert が keyPartsOf(key) から再計算するので渡した値は使われないが、
  // ObjectDescriptor の必須フィールドなので同じ導出で埋める。
  #indexObject(bucketId: string, object: R2Object): void {
    this.#backfillUpsert({
      bucketId,
      key: object.key,
      name: keyPartsOf(object.key).name,
      contentType: contentTypeOf(object.key),
      size: object.size,
      uploadedAt: object.uploaded.toISOString(),
      etag: object.httpEtag,
    });
  }

  // バックフィルの適用経路専用(I3)。live 経路(remove / upsert)との競合を 2 通り防ぐ。
  //
  // - ゴースト行: list のスナップショットを取った後に live remove されたキーは
  //   #tombstoneIfBackfillRunning がトゥームストーンを残しているので、ここでスキップする。
  //   スキップしないと、消えたはずのキーを再挿入してしまい、次のバックフィルまで
  //   自己修復しない幽霊行になる。
  // - スケール上書き: list 後に live upsert された行は、その uploadedAt がスナップ
  //   ショットの uploadedAt 以上ならスキップする。「既存行が今回のスナップショットと
  //   同じかそれより新しい」は、その行が live 経路(スナップショットより後)で書かれた
  //   ことの証拠になる。uploadedAt は ISO8601(常に UTC の Z 表記)で保存しているため、
  //   文字列としての `>=` 比較がそのまま時系列比較になる。
  //
  // 行が存在しない、または既存行がスナップショットより古い場合はそのまま upsert に
  // 委譲する。これにより「バックフィルを何度叩いても R2 の現在状態に追いつく」という
  // 冪等性は変わらない(既存コメント参照)。
  #backfillUpsert(descriptor: ObjectDescriptor): void {
    if (this.#isTombstoned(descriptor.key)) return;

    const existing = this.db.select({ uploadedAt: objects.uploadedAt }).from(objects).where(eq(objects.key, descriptor.key)).get();
    if (existing !== undefined && existing.uploadedAt >= descriptor.uploadedAt) return;

    this.upsert(descriptor);
  }

  #isTombstoned(key: string): boolean {
    return this.db.select({ key: backfillTombstones.key }).from(backfillTombstones).where(eq(backfillTombstones.key, key)).get() !== undefined;
  }

  // 1 ページ処理するたびに +1。BACKFILL_PAGES_KEY のコメント参照。
  #bumpPages(): void {
    this.#metaSet(BACKFILL_PAGES_KEY, `${parseInt(this.#metaGet(BACKFILL_PAGES_KEY) ?? '0', 10) + 1}`);
  }

  #markFailed(reason: string): void {
    this.#metaSet(BACKFILL_REASON_KEY, reason);
    // 失敗でも走行は終端に達しているので、complete と同様にトゥームストーンを消す(I3)。
    this.db.delete(backfillTombstones).run();
    this.#metaSet(BACKFILL_STATE_KEY, 'failed');
  }

  // meta は BUCKET_ID_KEY と同居する。**必ずキー単位で触ること**(モジュール冒頭の
  // BACKFILL_STATE_KEY のコメント参照)。
  //
  // meta.v は NULL 許容(schema.ts)なので、境界で undefined に寄せる。
  #metaGet(k: string): string | undefined {
    return this.db.select({ v: meta.v }).from(meta).where(eq(meta.k, k)).get()?.v ?? undefined;
  }

  #metaSet(k: string, v: string): void {
    this.db.insert(meta).values({ k, v }).onConflictDoUpdate({ target: meta.k, set: { v } }).run();
  }

  // 「未設定」は NULL ではなく行の不在で表す。#metaGet の判定を 1 本にするため。
  #metaClear(k: string): void {
    this.db.delete(meta).where(eq(meta.k, k)).run();
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
