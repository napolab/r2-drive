import { env } from 'cloudflare:test';

import type { ObjectIndex } from '../src/object-index/index';

// apps/web/worker-configuration.d.ts の OBJECT_INDEX は、実クラスが本番 Worker
// エントリ(apps/web/src/worker.ts)にまだ無いため wrangler types が
// `DurableObjectNamespace<undefined>` にしか解決できない。Task 10 で実クラスが
// worker.ts に載れば `cf-typegen` の再生成だけでこのキャストは不要になる。
// この形は複数のテストファイルで必要になるため、ここ 1 箇所に寄せる
// (Task 10 でのキャスト削除がここ 1 箇所で済む)。
export const objectIndexNamespace = env.OBJECT_INDEX as DurableObjectNamespace<ObjectIndex>;
