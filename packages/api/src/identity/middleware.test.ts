import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { identityMiddleware } from './middleware';

import type { HonoEnv } from '../env';

describe('identityMiddleware', () => {
  it('identity を解決できなければ 401 を返す', async () => {
    const app = new Hono<HonoEnv>().use('*', identityMiddleware).get('/', (c) => c.json({ ok: true }));

    const res = await app.request('http://localhost/', {}, { ...env, IDENTITY_PROVIDER: 'access' });

    expect(res.status).toBe(401);
  });

  it("identity を解決できれば c.get('identity') に入り、後続ハンドラが呼ばれる", async () => {
    const app = new Hono<HonoEnv>().use('*', identityMiddleware).get('/', (c) => c.json(c.get('identity')));

    const res = await app.request('http://localhost/', {}, { ...env, IDENTITY_PROVIDER: 'static' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: 'user', id: 'local', email: 'local@example.com', displayName: 'local', groups: [] });
  });
});
