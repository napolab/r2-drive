import { describeCauseChain } from '@r2-drive/core';

import { respondTo } from './responder/registry';

import type { Context } from 'hono';

// cause チェーンはここでだけ意味を持つ。JSON を越えると消える。
// クライアントへは name と message だけ返す(R2 のキーやバケット名を漏らさない)。
export const toErrorResponse = (c: Context, error: unknown) => {
  console.error(c.req.url, describeCauseChain(error));
  const { status, body } = respondTo(error);

  return c.json(body, status);
};
