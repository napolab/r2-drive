import { zValidator } from '@hono/zod-validator';
import { ObjectNotFoundError } from '@r2-drive/core';
import { Hono } from 'hono';
import { z } from 'zod';

import { toErrorResponse } from '../errors/to-error-response';
import { resolveObjectSource } from '../plugins/object-source/registry';
import { getObject } from '../r2/get';
import { parseRangeHeader } from '../r2/range';
import { bucketDescriptors, resolveBucket } from '../r2/registry';

import type { HonoEnv } from '../env';

const listQuery = z.object({ prefix: z.string().default(''), cursor: z.string().optional() });

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
  .get('/:bucketId/content/:path{.+}', async (c) => {
    const key = c.req.param('path');

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

            // R2 に渡した range はこの spec そのものなので、応答ヘッダも spec から直接計算する
            // (object.range を読み返すと 3 変分の判別可能ユニオンが `in` では narrow しきれない)。
            switch (spec.kind) {
              case 'whole': {
                headers.set('content-length', `${head.size}`);

                return new Response(object.body, { status: 200, headers });
              }
              case 'offset': {
                const length = head.size - spec.offset;
                headers.set('content-range', `bytes ${spec.offset}-${spec.offset + length - 1}/${head.size}`);
                headers.set('content-length', `${length}`);

                return new Response(object.body, { status: 206, headers });
              }
              case 'window': {
                headers.set('content-range', `bytes ${spec.offset}-${spec.offset + spec.length - 1}/${head.size}`);
                headers.set('content-length', `${spec.length}`);

                return new Response(object.body, { status: 206, headers });
              }
              case 'suffix': {
                const start = head.size - spec.suffix;
                headers.set('content-range', `bytes ${start}-${head.size - 1}/${head.size}`);
                headers.set('content-length', `${spec.suffix}`);

                return new Response(object.body, { status: 206, headers });
              }
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
  });
