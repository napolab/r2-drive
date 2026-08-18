import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { api } from '../src/index';

import { objectIndexNamespace } from './object-index-namespace';

import type { ObjectDescriptor, ObjectPage } from '@r2-drive/core';

// Ruling 18 を HTTP の口まで通して固定する。DO の中で投げた ForeignCursorError が
// RPC 境界で class を失っても(name だけが残る)、errors/responder/foreign-cursor が
// 412 として拾えることを実際の経路で確認する。単体テスト(registry.test.ts)は
// 「name で判別する」を張れるが、「RPC が本当に name を残す」までは張れない。
//
// 検索の口を使うのは、indexed フラグに関係なく必ず索引 DO へ届くため
// (buckets/index.ts の /:bucketId/search のコメント参照)。
const R2_LIKE_CURSOR = 'eyJrIjoiYS8xLnR4dCJ9';

it('R2 の opaque cursor を検索に渡すと 412 を返す', async () => {
  const res = await api.request(`/buckets/photos/search?q=a&cursor=${R2_LIKE_CURSOR}`, {}, env);

  expect(res.status).toBe(412);
  expect(await res.json()).toEqual({ name: 'PreconditionFailedError', message: 'cursor does not belong to the object index search route' });
});

// 412 のボディに cursor の中身(= 索引では key)を載せないこと。
it('412 のボディに cursor の中身を含めない', async () => {
  const res = await api.request(`/buckets/photos/search?q=a&cursor=${encodeURIComponent('secret/private.txt')}`, {}, env);

  expect(res.status).toBe(412);
  expect(JSON.stringify(await res.json())).not.toContain('private.txt');
});

// 自分が発行した cursor は通ること(拒否が広すぎないことの対照)。
it('検索が発行した cursor はそのまま次のページを返す', async () => {
  await api.request('/uploads/photos/single?key=fc%2Freport-1.txt', { method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain' } }, env);
  await api.request('/uploads/photos/single?key=fc%2Freport-2.txt', { method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain' } }, env);

  const first = (await (await api.request('/buckets/photos/search?q=report', {}, env)).json()) as ObjectPage;
  expect(first.objects.map((o) => o.key)).toEqual(['fc/report-1.txt', 'fc/report-2.txt']);

  // SEARCH_PAGE_SIZE(100)を超えないので next は end になる。cursor を人工的に
  // 作らず、索引が発行する形式そのものを次の要求に載せるため、1 件目の key から
  // 同じタグ形式を組み立てて渡す。
  const res = await api.request(`/buckets/photos/search?q=report&cursor=${encodeURIComponent('q1:fc/report-1.txt')}`, {}, env);
  expect(res.status).toBe(200);

  const second = (await res.json()) as ObjectPage;
  expect(second.objects.map((o) => o.key)).toEqual(['fc/report-2.txt']);
});

// Ruling 23 — 逆向き。**`indexed: false` のバケットでも踏める。**検索は indexed に
// 関わらず索引 DO を通るので `q1:` cursor を返し、それを一覧に渡すと R2 経路に流れる。
// R2 は不正な cursor を弾かず空ページを返す(実測。r2-list/r2-list.test.ts が前提を張っている)
// ので、一覧が静かに「ここで終わり」になる。412 で弾けることを実際の口で固定する。
//
// 本物の `q1:` cursor が要る(= 検索が 100 件を超えてページ分割される必要がある)ので、
// DO へ直接 101 件 upsert する。実アップロードを 101 回叩くより速い
// (search.integration.test.ts と同じ手口)。
const descriptorOf = (bucketId: string, key: string): ObjectDescriptor => ({
  bucketId,
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  contentType: 'application/octet-stream',
  size: 1,
  uploadedAt: '2026-08-18T00:00:00.000Z',
  etag: `"etag-${key}"`,
});

it('indexed: false のバケットでも、検索の cursor を一覧に渡すと 412 を返す', async () => {
  const stub = objectIndexNamespace.get(objectIndexNamespace.idFromName('media'));
  for (const i of Array.from({ length: 101 }, (_, index) => index)) {
    await stub.upsert(descriptorOf('media', `rev/journal-${`${i}`.padStart(3, '0')}.txt`));
  }

  const page = (await (await api.request('/buckets/media/search?q=journal', {}, env)).json()) as ObjectPage;
  if (page.next.kind !== 'more') throw new Error('検索が 2 ページ目を持たなかった');
  // 索引が実際に発行した形であることをここで確かめる(手で組み立てていない)。
  expect(page.next.cursor.startsWith('q1:')).toBe(true);

  const res = await api.request(`/buckets/media/objects?cursor=${encodeURIComponent(page.next.cursor)}`, {}, env);

  expect(res.status).toBe(412);
  expect(await res.json()).toEqual({ name: 'PreconditionFailedError', message: 'cursor does not belong to the r2 list route' });
});
