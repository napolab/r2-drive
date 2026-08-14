import { createMiddleware } from 'hono/factory';

import { toErrorResponse } from '../errors/to-error-response';
import { createIdentityProvider } from './factory';

import type { Identity } from './types';

declare module 'hono' {
  interface ContextVariableMap {
    identity: Identity;
  }
}

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
