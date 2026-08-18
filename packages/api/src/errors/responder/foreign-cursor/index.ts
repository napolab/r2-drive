import { err, ok } from 'neverthrow';

import { ForeignCursorError } from '../../../object-index/errors';

import type { ErrorResponder } from '../types';

// **判別を instanceof だけに頼れない。**この例外は Durable Object の中で投げられ、
// RPC 境界を越えて Worker 側へ届く。実測(2026-08-18、vitest-pool-workers 上で
// BucketMismatchError を DO 越しに受けて確認): 越えた先の値は Error のインスタンスだが
// `constructor.name === 'Error'` になり、`instanceof ForeignCursorError` は false になる。
// 一方 `name` と `message` は保存される。これは object-index/errors.ts と
// packages/core/src/errors/index.ts が言う「name は RPC / JSON を越えた先の wire 判別子」
// そのものなので、ここでは name で判別する。instanceof も併記するのは、同一 isolate 内
// (将来 DO を経由しない経路が生えた場合)からの到達を取りこぼさないため。
const isForeignCursor = (error: Error): boolean => error instanceof ForeignCursorError || error.name === 'ForeignCursorError';

// 412 / PreconditionFailedError にする(Ruling 18)。
//
// **wire 上の名前は新設しない。**ErrorName(packages/core/src/errors/wire.ts)は
// クライアントの exhaustive switch(packages/api/src/client.ts の toDriveError)と
// 対になっているので、名前を 1 つ足すと core とクライアントの両方が動く。
// このタスクは packages/core を変更しない前提で走っているため、既存の名前に載せる。
//
// 既存の 6 つのうち意味が最も近いのが PreconditionFailedError である。cursor は
// クライアントが「前のページの続きから」という条件を要求に添えたものであり、
// 経路が変わってその条件をサーバが履行できなくなった、という形が 412 と一致する。
// 回復手段も 412 の一般的な扱い(条件を外して要求し直す = cursor 無しで 1 ページ目から)
// と同じである。
//
// **ログ側の粒度は落とさない。**内部クラスは ForeignCursorError のままなので、
// describeCauseChain(toErrorResponse が出力する)には ForeignCursorError として残る。
// 落ちるのは wire に出る名前だけである。
//
// フォローアップ: ErrorName に 'ForeignCursorError' を足して 400 で返すほうが素直。
// packages/core を触れるタイミングで移すこと。
export const foreignCursorResponder: ErrorResponder = {
  id: 'foreign-cursor',
  run: (error) => (isForeignCursor(error) ? ok({ status: 412, body: { name: 'PreconditionFailedError', message: error.message } }) : err(error)),
};
