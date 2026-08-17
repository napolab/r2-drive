import { zValidator } from '@hono/zod-validator';
import { ObjectNotFoundError } from '@r2-drive/core';
import { Hono } from 'hono';
import { z } from 'zod';

import { toErrorResponse } from '../errors/to-error-response';
import { deleteObject } from '../r2/delete';
import { resolveObjectSource } from '../plugins/object-source/registry';
import { getObject } from '../r2/get';
import { parseRangeHeader, resolveContentRange } from '../r2/range';
import { bucketDescriptors, resolveBucket } from '../r2/registry';

import type { HonoEnv } from '../env';

const listQuery = z.object({ prefix: z.string().default(''), cursor: z.string().optional() });

// content-addressed URL のバージョン。クライアントは ObjectDescriptor.etag(= httpEtag、
// 引用符付き)をそのまま載せるので、ここでも引用符付きの文字列として素通しする。
// クエリ文字列なので存在しないことがある。
const contentQuery = z.object({ v: z.string().optional() });

// v が現在の etag と一致する = URL がその中身だけを指しているので、無期限に固めてよい。
// 上書きされれば etag が変わり URL も変わるため stale にならない。
// Access 配下の非公開ファイルなので private を外さないこと(共有プロキシに保存させない)。
const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'private, no-cache';

export const buckets = new Hono<HonoEnv>()
  .get('/', (c) => c.json({ buckets: bucketDescriptors.map(({ id, label }) => ({ id, label })) }, 200))
  .get('/:bucketId/objects', zValidator('query', listQuery), async (c) => {
    const { prefix, cursor } = c.req.valid('query');
    const request = { env: c.env, bucketId: c.req.param('bucketId'), prefix, cursor };

    return resolveObjectSource(request).match(
      (work) =>
        work.match(
          (page) => c.json(page, 200),
          (error) => toErrorResponse(c, error),
        ),
      (input) => toErrorResponse(c, new Error(`no object source for bucket: ${input.bucketId}`)),
    );
  })
  .get('/:bucketId/content/:path{.+}', zValidator('query', contentQuery), async (c) => {
    const key = c.req.param('path');
    const { v } = c.req.valid('query');

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) => {
        const head = await bucket.head(key);
        if (head === null) return toErrorResponse(c, new ObjectNotFoundError(key));

        const spec = parseRangeHeader(c.req.header('range') ?? null, head.size);
        if (spec.kind === 'unsatisfiable') {
          return c.body(null, 416, { 'content-range': `bytes */${head.size}`, 'accept-ranges': 'bytes' });
        }

        return getObject(bucket, key, spec).match(
          (object) => {
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set('accept-ranges', 'bytes');
            headers.set('etag', object.httpEtag);
            // writeHttpMetadata の後に置く。R2 の httpMetadata.cacheControl を必ず上書きするため。
            // バイト範囲は etag に対して不変なので、206 でも同じ判定でよい。
            headers.set('cache-control', v === object.httpEtag ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL);

            // R2 に渡した range はこの spec そのものなので、応答ヘッダも spec から直接計算する
            // (object.range を読み返すと 3 変分の判別可能ユニオンが `in` では narrow しきれない)。
            // start/end/length の算術自体は range.ts の resolveContentRange に抽出済み(単体テストあり)。
            const range = resolveContentRange(spec, head.size);
            headers.set('content-length', `${range.length}`);

            switch (spec.kind) {
              case 'whole':
                return new Response(object.body, { status: 200, headers });
              case 'offset':
              case 'window':
              case 'suffix':
                headers.set('content-range', `bytes ${range.start}-${range.end}/${range.total}`);

                return new Response(object.body, { status: 206, headers });
              default: {
                const _exhaustive: never = spec;
                throw new Error(`unhandled range spec: ${JSON.stringify(_exhaustive)}`);
              }
            }
          },
          (error) => toErrorResponse(c, error),
        );
      },
      async (error) => toErrorResponse(c, error),
    );
  })
  .delete('/:bucketId/objects/:path{.+}', async (c) => {
    const key = c.req.param('path');

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) =>
        deleteObject(bucket, key).match(
          (deleted) => c.json({ deleted }, 200),
          (error) => toErrorResponse(c, error),
        ),
      async (error) => toErrorResponse(c, error),
    );
  });
