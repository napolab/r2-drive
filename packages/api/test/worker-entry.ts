import { eq } from 'drizzle-orm';

import { api } from '../src/index';
import { ObjectIndex } from '../src/object-index/index';
import { objects, prefixes } from '../src/object-index/schema';

type ObjectRow = typeof objects.$inferSelect;
type PrefixRow = typeof prefixes.$inferSelect;

// テスト専用の DO クラス。production の ObjectIndex に置いてよいのは upsert / remove /
// count だけで、覗き見用のメソッドや DO SQLite の性質を測る probe を本番の RPC 表面に
// 常設しない(Ruling 10)。vitest.config.ts の durableObjects.className はこの
// クラスを指している。
//
// SqliteStore → ObjectIndex → ObjectIndexUnderTest の 3 段継承が RPC で正しく公開される
// ことは、このクラス経由で upsert / count を呼ぶテストが通ること自体が実証している
// (RPC は prototype chain を辿るので継承メソッドも公開される)。
//
// メソッドは必ず method shorthand で書くこと。arrow property は prototype ではなく
// インスタンスに乗るため RPC で公開されない。
export class ObjectIndexUnderTest extends ObjectIndex {
  debugRow(key: string): ObjectRow | undefined {
    return this.db.select().from(objects).where(eq(objects.key, key)).get();
  }

  // parent_prefix も返す。prefix 列だけを返していたため「prefixes.parent_prefix を
  // 'MUTANT' に固定してもテストが全部通る」という穴が空いていた。Task 5 の一覧は
  // この列で親を引くので、ここで検算できる形にしておく。
  debugPrefixes(): readonly PrefixRow[] {
    return this.db.select().from(prefixes).orderBy(prefixes.prefix).all();
  }

  // FTS5 の仮想テーブルは Drizzle で表現できないので raw SQL で覗く。
  // 「upsert したら引ける / remove したら引けない」を張るための読み取り専用の窓。
  debugFtsKeys(): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ key: string }>(`SELECT key FROM objects_fts ORDER BY key`)
      .toArray()
      .map((row) => row.key);
  }

  // 名前で MATCH できることまで見る(FTS5 に key/name を入れている意味の確認)。
  debugFtsSearch(query: string): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ key: string }>(`SELECT key FROM objects_fts WHERE objects_fts MATCH ? ORDER BY rank`, query)
      .toArray()
      .map((row) => row.key);
  }

  // 実際に適用された DDL を PRAGMA で読み返す窓。schema.ts の Drizzle 定義と
  // 手書き DDL のドリフト検出に使う(Ruling 12)。table 名は ? で束縛できるので
  // 文字列連結はしない。
  debugTableColumns(table: string): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, table)
      .toArray()
      .map((row) => row.name);
  }

  debugTableIndexes(table: string): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>(`SELECT name FROM pragma_index_list(?)`, table)
      .toArray()
      .map((row) => row.name);
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

export default api;
