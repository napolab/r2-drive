import { DurableObject } from 'cloudflare:workers';

import { api } from '../src/index';

// vitest-pool-workers が DO を実体化するには、Worker エントリから
// クラスが export されている必要がある。Task 3 でここを本物の ObjectIndex に差し替える。
export class ObjectIndex extends DurableObject<Env> {
  probeFts(): readonly string[] {
    this.ctx.storage.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(name)`);
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, '休暇の写真 vacation-2026.jpg');
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, 'invoice-2026-04.pdf');

    const rows = this.ctx.storage.sql.exec<{ name: string }>(`SELECT name FROM probe_fts WHERE probe_fts MATCH ? ORDER BY rank`, 'vacation').toArray();

    return rows.map((row) => row.name);
  }

  // 測定対象(probeAtomicityWith*)とは別の RPC 呼び出しに出すセットアップ。
  // CREATE / DELETE / seed をここで確実に完了させ、await 境界を挟むことで、
  // 測定対象の 2 文が「たまたま CREATE ごと巻き戻った」結果を原子性の証拠と
  // 誤読しないようにする。'seed' は 2 回目の INSERT で意図的に再利用し、
  // 実行時の UNIQUE 制約違反を起こすために残す。
  setupAtomicityProbe(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS probe_a (k TEXT PRIMARY KEY)`);
    this.ctx.storage.sql.exec(`DELETE FROM probe_a`);
    this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
  }

  // setupAtomicityProbe() の後に呼ぶこと。'first' の INSERT は成功し、
  // 'seed' の再 INSERT は主キー重複で実行時に確実に失敗する(prepare 段階では
  // 落ちない)。束ねられて原子的なら 'first' も巻き戻り行数は 1(seed のみ)、
  // 束ねられないなら 'first' が残り行数は 2 になる。
  probeAtomicityWithoutTransaction(): number {
    try {
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'first');
      // 主キー重複による UNIQUE 制約違反。実行時に確実に失敗する。
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
    } catch {
      // 例外は握る。ここで見たいのは probe_a の中身だけ。
    }

    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM probe_a`).one().n;
  }

  // probeAtomicityWithoutTransaction() の対照実験。同じ 2 文を
  // this.ctx.storage.transactionSync() で明示的に囲う。巻き戻り機構自体が
  // この環境で動くことを示すための positive control。
  probeAtomicityWithTransactionSync(): number {
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
