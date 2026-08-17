import { env } from 'cloudflare:test';

import type { ObjectIndexUnderTest } from './worker-entry';

// apps/web/worker-configuration.d.ts の OBJECT_INDEX は、実クラスが本番 Worker
// エントリ(apps/web/src/worker.ts)にまだ無いため wrangler types が
// `DurableObjectNamespace<undefined>` にしか解決できない。Task 10 で実クラスが
// worker.ts に載れば `cf-typegen` の再生成だけで <ObjectIndex> に解決される。
// この形は複数のテストファイルで必要になるため、ここ 1 箇所に寄せる。
//
// テストが実体化するのは覗き見用メソッドを足したサブクラス(Ruling 10)なので、
// キャスト先も ObjectIndexUnderTest である。本番の binding は ObjectIndex を指す。
export const objectIndexNamespace = env.OBJECT_INDEX as DurableObjectNamespace<ObjectIndexUnderTest>;
