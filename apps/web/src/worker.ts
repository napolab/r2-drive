import { cloudflareAccess } from '@hono/cloudflare-access';
import handler from '@tanstack/react-start/server-entry';
import { Hono } from 'hono';

import type { WorkerEnv } from './env';

// このファイルだけが @r2-drive/api を値として import してよい(spec §11.3)。
// Task 6 以降でここに実 API をマウントする。
const app = new Hono<{ Bindings: WorkerEnv }>();

// env はリクエスト時にしか存在しないので、ミドルウェア生成を c.env が読める位置に置く。
// 既定は "access"(fail-closed)。ローカルだけ .dev.vars で "static" に落とす。
// default が never に潰れているので、Task 7 で provider を増やしたらここが必ずコンパイルエラーになる。
app.use('*', (c, next) => {
  switch (c.env.IDENTITY_PROVIDER) {
    case 'access':
      return cloudflareAccess(c.env.ACCESS_TEAM, c.env.ACCESS_AUD)(c, next);
    case 'static':
      // ローカル開発。Access は Worker の前段に居ないので検証を飛ばす。
      return next();
    default: {
      const _exhaustive: never = c.env.IDENTITY_PROVIDER;
      // 実行時に未知の値が来たら素通しではなく落とす(fail-closed)。
      throw new Error(`unhandled identity provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
});

const api = new Hono<{ Bindings: WorkerEnv }>()
  .get('/ping', (c) => c.json({ ok: true }, 200))
  .get('/probe/r2', async (c) => {
    const listed = await c.env.BUCKET_PHOTOS.list({ limit: 1 });

    return c.json({ count: listed.objects.length }, 200);
  });

app.route('/api', api);

// TanStack Start が生成する Worker ハンドラ。env / executionCtx は cloudflare:workers 側の
// async context から取れるため、fetch には Request だけを渡す。
app.all('*', (c) => handler.fetch(c.req.raw));

export default app;
