import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

// 1x1 PNG(Task 3 と同じバイト。fixture は共有: test/fixtures/images.ts)
import { PNG_1x1 } from './fixtures/images';

import type { ObjectPage } from '@r2-drive/core';

describe('ObjectHook(uploaded / removed)', () => {
  it('画像のアップロードで索引に寸法まで入る', async () => {
    const res = await api.request('/uploads/photos/single?key=hook%2Fa.png', { method: 'PUT', body: PNG_1x1, headers: { 'content-type': 'image/png' } }, env);
    expect(res.status).toBe(200);

    const listed = await api.request('/buckets/photos/objects?prefix=hook%2F', {}, env);
    const page = (await listed.json()) as ObjectPage;
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 1, height: 1 });
  });

  it('非画像のアップロードは media: none のまま索引に入る', async () => {
    await api.request('/uploads/photos/single?key=hook%2Fb.txt', { method: 'PUT', body: 'text', headers: { 'content-type': 'text/plain' } }, env);
    const listed = await api.request('/buckets/photos/objects?prefix=hook%2F', {}, env);
    const page = (await listed.json()) as ObjectPage;
    const b = page.objects.find((o) => o.key === 'hook/b.txt');
    expect(b?.media).toEqual({ kind: 'none' });
  });

  it('削除で索引から消える(removed hook)', async () => {
    await api.request('/uploads/photos/single?key=hook%2Fc.png', { method: 'PUT', body: PNG_1x1, headers: { 'content-type': 'image/png' } }, env);
    await api.request('/buckets/photos/objects/hook/c.png', { method: 'DELETE' }, env);
    const listed = await api.request('/buckets/photos/objects?prefix=hook%2F', {}, env);
    const page = (await listed.json()) as ObjectPage;
    expect(page.objects.some((o) => o.key === 'hook/c.png')).toBe(false);
  });
});
