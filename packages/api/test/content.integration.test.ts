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
    expect(res.headers.get('content-range')).toBe('bytes 7-9/10');
  });

  it('bytes=7- は開区間', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=7-' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('hij');
    expect(res.headers.get('content-range')).toBe('bytes 7-9/10');
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

describe('GET /buckets/:bucketId/content/* の Cache-Control', () => {
  // ObjectDescriptor.etag は list.ts が httpEtag をそのまま載せるので引用符付き。
  // クライアントはその値を ?v= に渡すため、テストも引用符付きのまま往復させる。
  const currentEtag = async (key: string): Promise<string> => {
    const head = await env.BUCKET_PHOTOS.head(key);
    if (head === null) throw new Error(`missing fixture: ${key}`);

    return head.httpEtag;
  };

  const versioned = (key: string, v: string): string => `/buckets/photos/content/${key}?v=${encodeURIComponent(v)}`;

  beforeEach(async () => {
    await env.BUCKET_PHOTOS.put('f.txt', BODY);
  });

  it('v が etag と一致したら immutable で長期キャッシュ', async () => {
    const res = await api.request(versioned('f.txt', await currentEtag('f.txt')), {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  it('v が不一致でもエラーにせず、現在の中身を no-cache で返す', async () => {
    const res = await api.request(versioned('f.txt', '"stale-etag"'), {}, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('v が無いときは no-cache', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', {}, env);

    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('Range の 206 でも v が一致すれば immutable', async () => {
    const res = await api.request(versioned('f.txt', await currentEtag('f.txt')), { headers: { range: 'bytes=2-4' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('cde');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  it('R2 の httpMetadata に cacheControl があってもこちらの値で上書きする', async () => {
    await env.BUCKET_PHOTOS.put('metadata.txt', BODY, { httpMetadata: { cacheControl: 'public, max-age=60' } });

    const res = await api.request(versioned('metadata.txt', await currentEtag('metadata.txt')), {}, env);

    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  it('オブジェクトが上書きされて etag が変わったら、古い v は no-cache に落ちる', async () => {
    const stale = await currentEtag('f.txt');
    await env.BUCKET_PHOTOS.put('f.txt', 'REWRITTEN!');

    const res = await api.request(versioned('f.txt', stale), {}, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('REWRITTEN!');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });
});
