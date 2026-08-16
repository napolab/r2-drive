import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

const FIVE_MIB = 5 * 1024 * 1024;
const part = (size: number, fill: string) => new Uint8Array(size).fill(fill.charCodeAt(0));

const create = async (key: string) =>
  (await (await api.request('/uploads/photos', { method: 'POST', body: JSON.stringify({ key, contentType: 'text/plain' }), headers: { 'content-type': 'application/json' } }, env)).json()) as {
    uploadId: string;
    key: string;
  };

describe('single upload', () => {
  it('raw body と content type を保存して ETag を返す', async () => {
    const body = new TextEncoder().encode('hello from single upload');

    const res = await api.request('/uploads/photos/single?key=notes%2Fhello.txt', { method: 'PUT', body, headers: { 'content-type': 'text/plain; charset=utf-8' } }, env);

    expect(res.status).toBe(200);
    const stored = await env.BUCKET_PHOTOS.get('notes/hello.txt');
    expect(await stored?.text()).toBe('hello from single upload');
    expect(stored?.httpMetadata?.contentType).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('etag')).toBe(stored?.httpEtag);
  });

  it('zero-byte body と空の content type を明示的な fallback で保存する', async () => {
    const res = await api.request('/uploads/photos/single?key=empty.bin', { method: 'PUT' }, env);

    expect(res.status).toBe(200);
    const stored = await env.BUCKET_PHOTOS.get('empty.bin');
    expect(stored?.size).toBe(0);
    expect(stored?.httpMetadata?.contentType).toBe('application/octet-stream');
    expect(res.headers.get('etag')).toBe(stored?.httpEtag);
  });

  it('未知の bucket は 404 と BucketNotFoundError を返す', async () => {
    const res = await api.request('/uploads/unknown/single?key=file.bin', { method: 'PUT', body: new Uint8Array([1]) }, env);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ name: 'BucketNotFoundError' });
  });
});

describe('multipart upload', () => {
  it('create → part ×2 → complete でオブジェクトができる', async () => {
    const { uploadId, key } = await create('big.bin');

    const p1 = await api.request(`/uploads/photos/${uploadId}/parts/1?key=${key}`, { method: 'PUT', body: part(FIVE_MIB, 'a') }, env);
    const p2 = await api.request(`/uploads/photos/${uploadId}/parts/2?key=${key}`, { method: 'PUT', body: part(1024, 'b') }, env);

    expect(p1.status).toBe(200);
    expect(p1.headers.get('etag')).toBeTruthy();

    const res = await api.request(
      `/uploads/photos/${uploadId}/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key,
          parts: [
            { partNumber: 1, etag: p1.headers.get('etag') },
            { partNumber: 2, etag: p2.headers.get('etag') },
          ],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const head = await env.BUCKET_PHOTOS.head('big.bin');
    expect(head?.size).toBe(FIVE_MIB + 1024);
  });

  it('abort するとオブジェクトが残らない', async () => {
    const { uploadId, key } = await create('aborted.bin');
    await api.request(`/uploads/photos/${uploadId}/parts/1?key=${key}`, { method: 'PUT', body: part(FIVE_MIB, 'a') }, env);

    const res = await api.request(`/uploads/photos/${uploadId}?key=${key}`, { method: 'DELETE' }, env);

    expect(res.status).toBe(200);
    expect(await env.BUCKET_PHOTOS.head('aborted.bin')).toBeNull();
  });

  it('未知の uploadId は 409 と UploadSessionError', async () => {
    const res = await api.request('/uploads/photos/bogus-upload-id/parts/1?key=x.bin', { method: 'PUT', body: part(16, 'a') }, env);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ name: 'UploadSessionError', reason: 'unknown-upload-id' });
  });

  it('partNumber が 10000 を超えると 409', async () => {
    const { uploadId, key } = await create('x.bin');
    const res = await api.request(`/uploads/photos/${uploadId}/parts/10001?key=${key}`, { method: 'PUT', body: part(16, 'a') }, env);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: 'too-many-parts' });
  });
});
