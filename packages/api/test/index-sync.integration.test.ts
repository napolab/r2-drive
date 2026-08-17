import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { api } from '../src/index';

import { objectIndexNamespace } from './object-index-namespace';

// bucketDescriptors.indexed は false なので、この統合テストでは
// 「索引に書かれること」を DO 直読みで確認する(一覧経路はまだ R2)。
const indexOf = (bucketId: string) => objectIndexNamespace.get(objectIndexNamespace.idFromName(bucketId));

it('単発アップロードが索引に行を作る', async () => {
  const res = await api.request('/uploads/photos/single?key=sync%2Fa.txt', { method: 'PUT', body: 'hello', headers: { 'content-type': 'text/plain' } }, env);
  expect(res.status).toBe(200);

  await expect(indexOf('photos').debugRow('sync/a.txt')).resolves.toMatchObject({ name: 'a.txt', parentPrefix: 'sync/', contentType: 'text/plain' });
});

it('multipart complete が索引に行を作る', async () => {
  const created = (await (
    await api.request('/uploads/photos', { method: 'POST', body: JSON.stringify({ key: 'sync/m.txt', contentType: 'text/plain' }), headers: { 'content-type': 'application/json' } }, env)
  ).json()) as { readonly uploadId: string; readonly key: string };
  const part = await api.request(`/uploads/photos/${created.uploadId}/parts/1?key=sync%2Fm.txt`, { method: 'PUT', body: 'hello' }, env);
  const etag = part.headers.get('etag');
  if (etag === null) throw new Error('パートの etag が返らなかった');

  const res = await api.request(
    `/uploads/photos/${created.uploadId}/complete`,
    { method: 'POST', body: JSON.stringify({ key: 'sync/m.txt', parts: [{ partNumber: 1, etag }] }), headers: { 'content-type': 'application/json' } },
    env,
  );
  expect(res.status).toBe(200);

  await expect(indexOf('photos').debugRow('sync/m.txt')).resolves.toMatchObject({ name: 'm.txt', parentPrefix: 'sync/' });
});

it('削除が索引から行を消す', async () => {
  await api.request('/uploads/photos/single?key=sync%2Fb.txt', { method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain' } }, env);
  const res = await api.request('/buckets/photos/objects/sync/b.txt', { method: 'DELETE' }, env);
  expect(res.status).toBe(200);

  await expect(indexOf('photos').debugRow('sync/b.txt')).resolves.toBeUndefined();
});

// Ruling 16: 索引の contentType は packages/api/src/r2/list.ts の contentTypeOf(key) を
// 共有して導出する。R2 一覧経路は httpMetadata を参照せず拡張子から毎回導出しているため
// (Task 16)、索引側がリクエストヘッダの content-type をそのまま書くと、同じキーが
// indexed の有無で違う contentType を返してしまう。ここでは拡張子(.bin)と
// content-type ヘッダ(image/jpeg)をわざと食い違わせ、索引に入る値が拡張子由来
// (application/octet-stream)であることを固定する。
it('拡張子と content-type ヘッダが食い違っても索引は拡張子由来の値を持つ', async () => {
  const res = await api.request('/uploads/photos/single?key=sync%2Fmismatch.bin', { method: 'PUT', body: 'x', headers: { 'content-type': 'image/jpeg' } }, env);
  expect(res.status).toBe(200);

  await expect(indexOf('photos').debugRow('sync/mismatch.bin')).resolves.toMatchObject({ contentType: 'application/octet-stream' });
});
