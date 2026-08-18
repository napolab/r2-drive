import { Hono } from 'hono';

import { buckets } from './buckets/index';
import { uploads } from './uploads/index';

import type { HonoEnv } from './env';

export const api = new Hono<HonoEnv>().route('/buckets', buckets).route('/uploads', uploads);

export type AppType = typeof api;

export { identityMiddleware } from './identity/middleware';

// Durable Object のクラスは Worker のエントリから export されている必要がある
// (wrangler.jsonc の class_name はエントリの export 名で解決される)。
// @r2-drive/api を値として import してよいのは apps/web/src/worker.ts だけなので、
// そこから再輸出できるようにここで公開する。
export { ObjectIndex } from './object-index/index';
