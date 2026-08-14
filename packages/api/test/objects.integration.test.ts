import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

import type { ObjectPage } from '@r2-drive/core';

const put = (key: string, body: string) => env.BUCKET_PHOTOS.put(key, body);

describe('GET /buckets/:bucketId/objects', () => {
  beforeEach(async () => {
    await put('a.txt', 'a');
    await put('docs/b.md', 'b');
    await put('docs/nested/c.md', 'c');
  });

  it('delimiter でフォルダとオブジェクトを分ける', async () => {
    const res = await api.request('/buckets/photos/objects', {}, env);
    expect(res.status).toBe(200);
    const page = (await res.json()) as ObjectPage;

    expect(page.objects.map((o) => o.key)).toEqual(['a.txt']);
    expect(page.folders.map((f) => f.prefix)).toEqual(['docs/']);
    expect(page.next).toEqual({ kind: 'end' });
  });

  it('prefix で潜れる', async () => {
    const res = await api.request('/buckets/photos/objects?prefix=docs%2F', {}, env);
    const page = (await res.json()) as ObjectPage;

    expect(page.objects.map((o) => o.name)).toEqual(['b.md']);
    expect(page.folders.map((f) => f.name)).toEqual(['nested']);
  });

  it('contentType が空でも拡張子から埋まる', async () => {
    const res = await api.request('/buckets/photos/objects?prefix=docs%2F', {}, env);
    const page = (await res.json()) as ObjectPage;
    const [first] = page.objects;

    expect(first?.contentType).toBe('text/markdown');
  });

  it('未登録バケットは 404 と BucketNotFoundError', async () => {
    const res = await api.request('/buckets/nope/objects', {}, env);
    expect(res.status).toBe(404);

    expect(await res.json()).toEqual({ name: 'BucketNotFoundError', message: 'nope' });
  });
});
