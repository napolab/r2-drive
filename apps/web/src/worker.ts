import { cloudflareAccess } from '@hono/cloudflare-access';
import handler from '@tanstack/react-start/server-entry';
import { Hono } from 'hono';

// このファイルだけが @r2-drive/api を値として import してよい(spec §11.3)。
// Task 6 以降でここに実 API をマウントする。
const app = new Hono<{ Bindings: Env }>();

// env はリクエスト時にしか存在しないので、ミドルウェア生成を c.env が読める位置に置く。
// ローカル(wrangler dev)には Access が居ないため、IDENTITY_PROVIDER === 'static' のときは飛ばす。
// Task 7 で identityMiddleware に統合する。
app.use('*', (c, next) => (c.env.IDENTITY_PROVIDER === 'static' ? next() : cloudflareAccess(c.env.ACCESS_TEAM, c.env.ACCESS_AUD)(c, next)));

const api = new Hono<{ Bindings: Env }>()
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
