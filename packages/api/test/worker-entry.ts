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
}

export default api;
