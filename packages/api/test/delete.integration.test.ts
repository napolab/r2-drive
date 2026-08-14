import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

describe('DELETE /buckets/:bucketId/objects/*', () => {
  beforeEach(async () => {
    await env.BUCKET_PHOTOS.put('a.txt', 'a');
    await env.BUCKET_PHOTOS.put('b.txt', 'b');
  });

  it('単一オブジェクトを消す', async () => {
    const res = await api.request('/buckets/photos/objects/a.txt', { method: 'DELETE' }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: ['a.txt'] });
    expect(await env.BUCKET_PHOTOS.head('a.txt')).toBeNull();
    expect(await env.BUCKET_PHOTOS.head('b.txt')).not.toBeNull();
  });

  it('存在しないキーの削除も 200(冪等)', async () => {
    const res = await api.request('/buckets/photos/objects/nope.txt', { method: 'DELETE' }, env);

    expect(res.status).toBe(200);
  });

  it('未登録バケットは 404', async () => {
    const res = await api.request('/buckets/nope/objects/a.txt', { method: 'DELETE' }, env);

    expect(res.status).toBe(404);
  });
});
