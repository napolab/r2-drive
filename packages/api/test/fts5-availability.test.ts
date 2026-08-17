import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import type { ObjectIndex } from './worker-entry';

// apps/web/worker-configuration.d.ts の OBJECT_INDEX は、実クラスが本番 Worker
// エントリ(apps/web/src/worker.ts)にまだ無いため wrangler types が
// `DurableObjectNamespace<undefined>` にしか解決できない。Task 3 で実クラスが
// worker.ts に載れば `cf-typegen` の再生成だけでこのキャストは不要になる。
const namespace = env.OBJECT_INDEX as DurableObjectNamespace<ObjectIndex>;

// spec §12 のリスク 1。Cloudflare は対応拡張の一覧を D1 と DO で共有して記述しているが、
// DO で明示的に検証した記述は確認できていない。ここで実測して固定する。
it('DO の SQLite で FTS5 の仮想テーブルが作れて MATCH が引ける', async () => {
  const stub = namespace.get(namespace.idFromName('fts-probe'));

  await expect(stub.probeFts()).resolves.toEqual(['休暇の写真 vacation-2026.jpg']);
});
