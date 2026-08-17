import { count as countRows, eq } from 'drizzle-orm';

import { BucketMismatchError } from './errors';
import { keyPartsOf } from './key-parts/index';
import { meta, objects, prefixes } from './schema';
import { SqliteStore } from './sqlite-store';

import type { ObjectDescriptor } from '@r2-drive/core';
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

// 1 バケット = 1 DO の不変条件を DO 側に焼き付けるための meta キー。
export const BUCKET_ID_KEY = 'bucket_id';

// db.transaction() のコールバックが受け取る tx。Drizzle は型名を公開していないので
// database 型から引き出す。
type Tx = Parameters<Parameters<DrizzleSqliteDODatabase<Record<string, never>>['transaction']>[0]>[0];

// prefix('a/b/') の親 prefix は、末尾の '/' を落としたキーの親と同じ。
const parentPrefixOf = (prefix: string): string => keyPartsOf(prefix.slice(0, -1)).parentPrefix;

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
