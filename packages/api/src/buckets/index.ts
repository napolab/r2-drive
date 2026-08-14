import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { toErrorResponse } from '../errors/to-error-response';
import { bucketDescriptors } from '../r2/registry';
import { resolveObjectSource } from '../plugins/object-source/registry';

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
  });
