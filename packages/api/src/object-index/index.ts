import { count as countRows, eq } from 'drizzle-orm';

import { keyPartsOf } from './key-parts/index';
import { objects, prefixes } from './schema';
import { SqliteStore } from './sqlite-store';

import type { ObjectDescriptor } from '@r2-drive/core';

type ObjectRow = typeof objects.$inferSelect;

// prefix('a/b/') の親 prefix は、末尾の '/' を落としたキーの親と同じ。
const parentPrefixOf = (prefix: string): string => keyPartsOf(prefix.slice(0, -1)).parentPrefix;

export class ObjectIndex extends SqliteStore {
  // objects / prefixes は Drizzle で、objects_fts(FTS5 の仮想テーブル。Drizzle では
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
    const [row] = this.db.select({ total: countRows() }).from(objects).all();

    return row?.total ?? 0;
  }

  // ここから下はテスト専用。RPC で読めるようにメソッドとして公開する。
  debugRow(key: string): ObjectRow | undefined {
    const [row] = this.db.select().from(objects).where(eq(objects.key, key)).all();

    return row;
  }

  debugPrefixes(): readonly string[] {
    return this.db
      .select({ prefix: prefixes.prefix })
      .from(prefixes)
      .orderBy(prefixes.prefix)
      .all()
      .map((row) => row.prefix);
  }

  // 以下 4 つは Task 1 / 2 が DO SQLite の性質を実測で固定するための probe。
  // 実装の一部ではないが、この 2 つの事実(FTS5 が使える / 連続 sql.exec は原子的でない)
  // の上に upsert の設計が乗っているので、回帰検出のために残している。
  debugProbeFts(): readonly string[] {
    this.ctx.storage.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(name)`);
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, '休暇の写真 vacation-2026.jpg');
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, 'invoice-2026-04.pdf');

    const rows = this.ctx.storage.sql.exec<{ name: string }>(`SELECT name FROM probe_fts WHERE probe_fts MATCH ? ORDER BY rank`, 'vacation').toArray();

    return rows.map((row) => row.name);
  }

  // 測定対象(debugProbeAtomicityWith*)とは別の RPC 呼び出しに出すセットアップ。
  // CREATE / DELETE / seed をここで確実に完了させ、await 境界を挟むことで、
  // 測定対象の 2 文が「たまたま CREATE ごと巻き戻った」結果を原子性の証拠と
  // 誤読しないようにする。'seed' は 2 回目の INSERT で意図的に再利用し、
  // 実行時の UNIQUE 制約違反を起こすために残す。
  debugSetupAtomicityProbe(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS probe_a (k TEXT PRIMARY KEY)`);
    this.ctx.storage.sql.exec(`DELETE FROM probe_a`);
    this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
  }

  // debugSetupAtomicityProbe() の後に呼ぶこと。'first' の INSERT は成功し、
  // 'seed' の再 INSERT は主キー重複で実行時に確実に失敗する(prepare 段階では
  // 落ちない)。束ねられて原子的なら 'first' も巻き戻り行数は 1(seed のみ)、
  // 束ねられないなら 'first' が残り行数は 2 になる。
  debugProbeAtomicityWithoutTransaction(): number {
    try {
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'first');
      // 主キー重複による UNIQUE 制約違反。実行時に確実に失敗する。
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
    } catch {
      // 例外は握る。ここで見たいのは probe_a の中身だけ。
    }

    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM probe_a`).one().n;
  }

  // debugProbeAtomicityWithoutTransaction() の対照実験。同じ 2 文を
  // this.ctx.storage.transactionSync() で明示的に囲う。巻き戻り機構自体が
  // この環境で動くことを示すための positive control。
  debugProbeAtomicityWithTransactionSync(): number {
    try {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'first');
        // 主キー重複による UNIQUE 制約違反。実行時に確実に失敗する。
        this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
      });
    } catch {
      // transactionSync はロールバック後に元の例外を再送出する。ここで見たいのは
      // probe_a の中身だけなので握る。
    }

    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM probe_a`).one().n;
  }
}
