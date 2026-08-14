import { createMiddleware } from 'hono/factory';

import { toErrorResponse } from '../errors/to-error-response';
import { createIdentityProvider } from './factory';

import type { Identity } from './types';

declare module 'hono' {
  interface ContextVariableMap {
    identity: Identity;
  }
}

// このミドルウェアは、IDENTITY_PROVIDER === 'access' のときに限り、同じチェーン内で
// より早く Access の署名検証(@hono/cloudflare-access)が走っていない限りマウントしてはならない。
// cloudflareAccessIdentity は検証済みペイロードの正規化のみを行い、署名は検証しない。
// 将来 packages/api を独立 Worker として分割する場合、この前提を必ず引き継ぐこと
// (.oxlintrc.json の @r2-drive/api インポート制限は相対 import には効かないため、
// 分割後は本コメントだけが唯一のガードになる)。
export const identityMiddleware = createMiddleware(async (c, next) =>
  createIdentityProvider(c.env)
    .resolve(c.req.raw)
    .match(
      async (identity) => {
        c.set('identity', identity);

        return next();
      },
      async (error) => toErrorResponse(c, error),
    ),
);
