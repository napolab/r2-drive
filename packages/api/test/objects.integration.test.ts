import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

import type { ObjectPage } from '@r2-drive/core';

const put = (key: string, body: string) => env.BUCKET_PHOTOS.put(key, body);
const putWithContentType = (key: string, body: string, contentType: string) => env.BUCKET_PHOTOS.put(key, body, { httpMetadata: { contentType } });

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

  it('一覧の contentType は保存済み httpMetadata より拡張子が勝つ', async () => {
    // .md 拡張子だが httpMetadata.contentType を明示している。
    // list() から include: ['httpMetadata'] を外したので R2 は httpMetadata を返さず、
    // contentTypeOf は拡張子(text/markdown)で確定する。
    // include を付けると 1 ページが 100 件に丸められるため、往復数を優先して外した
    // (`packages/api/src/r2/list.ts` の contentTypeOf のコメントに理由がある)。
    await putWithContentType('docs/typed.md', 'x', 'text/plain');

    const res = await api.request('/buckets/photos/objects?prefix=docs%2F', {}, env);
    const page = (await res.json()) as ObjectPage;
    const typed = page.objects.find((o) => o.key === 'docs/typed.md');

    expect(typed?.contentType).toBe('text/markdown');
  });

  it('未登録バケットは 404 と BucketNotFoundError', async () => {
    const res = await api.request('/buckets/nope/objects', {}, env);
    expect(res.status).toBe(404);

    expect(await res.json()).toEqual({ name: 'BucketNotFoundError', message: 'nope' });
  });
});
