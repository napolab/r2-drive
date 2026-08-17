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

  // 1 本目は成功し 2 本目が必ず失敗する書き込みを流し、1 本目が巻き戻るかを見る。
  // 巻き戻れば原子的、残れば原子的でない。
  probeAtomicity(): number {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS probe_a (k TEXT PRIMARY KEY)`);
    this.ctx.storage.sql.exec(`DELETE FROM probe_a`);
    try {
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'first');
      // 存在しない表への INSERT なので必ず失敗する。
      this.ctx.storage.sql.exec(`INSERT INTO probe_missing (k) VALUES (?)`, 'second');
    } catch {
      // 例外は握る。ここで見たいのは probe_a の中身だけ。
    }

    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM probe_a`).one().n;
  }
}

export default api;
