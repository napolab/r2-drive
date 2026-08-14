import { Hono } from 'hono';

import { buckets } from './buckets/index';
import { uploads } from './uploads/index';

import type { HonoEnv } from './env';

export const api = new Hono<HonoEnv>().route('/buckets', buckets).route('/uploads', uploads);

export type AppType = typeof api;

export { identityMiddleware } from './identity/middleware';
