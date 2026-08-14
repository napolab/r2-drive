import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

const BODY = 'abcdefghij';

describe('GET /buckets/:bucketId/content/*', () => {
  beforeEach(async () => {
    await env.BUCKET_PHOTOS.put('f.txt', BODY);
  });

  it('Range 無しは 200 で全体', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', {}, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
  });

  it('bytes=2-4 は 206 と Content-Range', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=2-4' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('cde');
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10');
  });

  it('bytes=-3 は末尾 3 バイト', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=-3' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('hij');
  });

  it('bytes=7- は開区間', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=7-' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('hij');
  });

  it('複数レンジは 416', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=0-1,4-5' } }, env);

    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */10');
  });

  it('存在しないキーは 404', async () => {
    const res = await api.request('/buckets/photos/content/nope.txt', {}, env);

    expect(res.status).toBe(404);
  });
});
