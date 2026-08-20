import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { api } from '../src/index';

import { objectIndexNamespace } from './object-index-namespace';
import { waitForBackfill } from './wait-for-backfill';

// バックフィルの状態は DO に永続する。このファイル内では 'photos' を「一度も走らせない
// バケット」、'media' を「走らせるバケット」として使い分けている(vitest はファイル内の
// テストを宣言順に実行するが、バケットを分けることで順序に依存しないようにしてある)。

it('一度も走っていないバケットの status は idle', async () => {
  const res = await api.request('/buckets/photos/index/status', {}, env);

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ kind: 'idle' });
});

// 202 = 受け付けた。走り切ってはいない。同期で待たせないための状態コード。
it('backfill の起動が 202 と running を返す', async () => {
  const res = await api.request('/buckets/media/index/backfill', { method: 'POST' }, env);

  expect(res.status).toBe(202);
  await expect(res.json()).resolves.toMatchObject({ kind: 'running' });
});

it('走らせきると status が complete と件数を返す', async () => {
  await env.BUCKET_MEDIA.put('api/1.txt', 'x');
  const started = await api.request('/buckets/media/index/backfill', { method: 'POST' }, env);
  expect(started.status).toBe(202);

  await waitForBackfill(objectIndexNamespace.get(objectIndexNamespace.idFromName('media')));

  const res = await api.request('/buckets/media/index/status', {}, env);
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ kind: 'complete', indexed: 1, mediaPending: 0 });
});

it('存在しないバケットの status は 404', async () => {
  const res = await api.request('/buckets/nope/index/status', {}, env);

  expect(res.status).toBe(404);
});

it('存在しないバケットの backfill は 404', async () => {
  const res = await api.request('/buckets/nope/index/backfill', { method: 'POST' }, env);

  expect(res.status).toBe(404);
});
