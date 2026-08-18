import { env } from 'cloudflare:test';

import type { ObjectIndexUnderTest } from './worker-entry';

// Env.OBJECT_INDEX は DurableObjectNamespace<ObjectIndex> に解決される(Task 10 で
// apps/web/src/worker.ts が ObjectIndex を再輸出したため)。本番の binding が指すのは
// ObjectIndex だが、テストが実体化するのは覗き見用メソッドを足したサブクラスなので
// (vitest.config.ts の durableObjects.className = 'ObjectIndexUnderTest'、Ruling 10)、
// ここでサブクラスへ narrow する。
//
// **このキャストは production 側の型不足ではなく、テスト構成そのものに由来する。**
// 本番の型定義は ObjectIndex しか知らないし、知る必要も無い。この形は複数のテスト
// ファイルで必要になるため、ここ 1 箇所に寄せる。
export const objectIndexNamespace = env.OBJECT_INDEX as DurableObjectNamespace<ObjectIndexUnderTest>;
