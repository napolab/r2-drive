import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

import type { ObjectDescriptor } from '@r2-drive/core';

describe('GET /buckets/:bucketId/objects/:path{.+}(単一オブジェクト取得)', () => {
  beforeEach(async () => {
    await env.BUCKET_MEDIA.put('docs/note.md', '# hi');
  });

  it('ObjectDescriptor を 1 件返す', async () => {
    const res = await api.request('/buckets/media/objects/docs/note.md', {}, env);
    expect(res.status).toBe(200);
    const descriptor = (await res.json()) as ObjectDescriptor;

    expect(descriptor.bucketId).toBe('media');
    expect(descriptor.key).toBe('docs/note.md');
    expect(descriptor.name).toBe('note.md');
    expect(descriptor.contentType).toBe('text/markdown');
    expect(descriptor.size).toBe(4);
    expect(descriptor.etag).toMatch(/^"/); // httpEtag は引用符付き
  });

  it('存在しない key は 404', async () => {
    const res = await api.request('/buckets/media/objects/missing.txt', {}, env);
    expect(res.status).toBe(404);
  });

  it('一覧ルート(splat なし)を隠さない', async () => {
    const res = await api.request('/buckets/media/objects', {}, env);
    expect(res.status).toBe(200);
  });
});
