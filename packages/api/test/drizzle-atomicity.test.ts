import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import type { ObjectIndex } from './worker-entry';

// apps/web/worker-configuration.d.ts の OBJECT_INDEX は、実クラスが本番 Worker
// エントリ(apps/web/src/worker.ts)にまだ無いため wrangler types が
// `DurableObjectNamespace<undefined>` にしか解決できない。Task 3 で実クラスが
// worker.ts に載れば `cf-typegen` の再生成だけでこのキャストは不要になる。
const namespace = env.OBJECT_INDEX as DurableObjectNamespace<ObjectIndex>;

// spec §12 のリスク 2。await を挟まない sql.exec が 1 トランザクションに束ねられるなら、
// 2 本目が失敗した時点で 1 本目も巻き戻り、行数は 0 になるはずだった。
//
// 実測(2026-08-17): 1 行だった。1 本目は巻き戻らず残る。つまり await を挟まない
// 連続 sql.exec は原子的に束ねられない。期待値の `1` は「テストを通すために合わせた値」
// ではなく、実測でそう出たことを固定するために書き換えている。書き込みを原子的にしたい
// 経路は `this.ctx.storage.transactionSync()` で明示的に囲う必要がある。
it('await を挟まない連続 sql.exec は失敗しても 1 本目が残る(束ねられない)', async () => {
  const stub = namespace.get(namespace.idFromName('atomicity-probe'));

  await expect(stub.probeAtomicity()).resolves.toBe(1);
});
