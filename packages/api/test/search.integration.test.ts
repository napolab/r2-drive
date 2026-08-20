import { NO_MEDIA } from '@r2-drive/core';
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { api } from '../src/index';

import { objectIndexNamespace } from './object-index-namespace';

import type { ObjectDescriptor, ObjectPage } from '@r2-drive/core';

// vitest-pool-workers のストレージ分離はファイル単位(object-index.test.ts のコメント参照)。
// 同一ファイル内の it 間で書き込みは巻き戻らないため、テストごとに bucket / query 語を
// 使い分けて互いのデータを拾わないようにする。
const indexOf = (bucketId: string) => objectIndexNamespace.get(objectIndexNamespace.idFromName(bucketId));

const descriptorOf = (bucketId: string, key: string, overrides: Partial<ObjectDescriptor> = {}): ObjectDescriptor => ({
  bucketId,
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  contentType: 'application/octet-stream',
  size: 1,
  uploadedAt: '2026-08-17T00:00:00.000Z',
  etag: `"etag-${key}"`,
  media: NO_MEDIA,
  ...overrides,
});

it('検索が索引から結果を返す', async () => {
  await api.request('/uploads/photos/single?key=s%2Fvacation-2026.jpg', { method: 'PUT', body: 'x', headers: { 'content-type': 'image/jpeg' } }, env);
  await api.request('/uploads/photos/single?key=s%2Finvoice.pdf', { method: 'PUT', body: 'x', headers: { 'content-type': 'application/pdf' } }, env);

  const res = await api.request('/buckets/photos/search?q=vacation', {}, env);
  expect(res.status).toBe(200);

  const page = (await res.json()) as ObjectPage;
  expect(page).toMatchObject({ folders: [], next: { kind: 'end' } });
  expect(page.objects.map((o) => o.key)).toEqual(['s/vacation-2026.jpg']);
});

it('q が空文字なら 400 を返す', async () => {
  const res = await api.request('/buckets/photos/search?q=', {}, env);

  expect(res.status).toBe(400);
});

it('存在しないバケットは 404 を返す', async () => {
  const res = await api.request('/buckets/nope/search?q=a', {}, env);

  expect(res.status).toBe(404);
});

// Ruling 17(実測日 2026-08-17): FTS5 の既定 tokenizer(unicode61)は連続する CJK
// 文字列全体を 1 トークンとして扱い、単語分割しない。そのため「休暇の写真.jpg」に
// 対する日本語クエリは、連続する非 ASCII ランの「先頭一致」しか引けない。
//
// | クエリ            | ヒットするか |
// | ------------------ | ------------ |
// | 休暇の写真(全体)  | ヒットする   |
// | 休暇(先頭)        | ヒットする   |
// | 写真(末尾)        | ヒットしない |
// | 暇の写(中間)      | ヒットしない |
//
// tokenize = 'trigram' に変えても解決しない: FTS5 の trigram tokenizer は 3 文字未満の
// クエリにマッチしないため、「写真」のような 2 文字の日本語クエリはそもそも trigram を
// 構成できず引けない。この実測値が spec の「Phase 5(Vectorize 意味検索)の要否は
// FTS5 を実際に使ってから判断する」の判断材料になる。「末尾/中間が引けない」ことを
// このテストで固定し、将来 tokenizer を変えたときに気付けるようにする。
it('日本語クエリは連続する非ASCIIランの先頭一致だけがヒットする(Ruling 17)', async () => {
  await api.request(`/uploads/photos/single?key=${encodeURIComponent('jp/休暇の写真.jpg')}`, { method: 'PUT', body: 'x', headers: { 'content-type': 'image/jpeg' } }, env);

  const whole = (await (await api.request(`/buckets/photos/search?q=${encodeURIComponent('休暇の写真')}`, {}, env)).json()) as ObjectPage;
  expect(whole.objects.map((o) => o.key)).toEqual(['jp/休暇の写真.jpg']);

  const head = (await (await api.request(`/buckets/photos/search?q=${encodeURIComponent('休暇')}`, {}, env)).json()) as ObjectPage;
  expect(head.objects.map((o) => o.key)).toEqual(['jp/休暇の写真.jpg']);

  const tail = (await (await api.request(`/buckets/photos/search?q=${encodeURIComponent('写真')}`, {}, env)).json()) as ObjectPage;
  expect(tail.objects).toEqual([]);

  const middle = (await (await api.request(`/buckets/photos/search?q=${encodeURIComponent('暇の写')}`, {}, env)).json()) as ObjectPage;
  expect(middle.objects).toEqual([]);
});

// SEARCH_PAGE_SIZE(100)が実際にルートへ渡っていることを固定する。'media' バケットを
// 使って 'photos' バケットの他テストのデータと混ざらないようにする。DO への直接
// upsert で 101 件を作るのは、実 R2 upload を 101 回叩くより速いため
// (index-sync.integration.test.ts と同じ DO 直操作の使い方)。
//
// 変異注入で確認済み: SEARCH_PAGE_SIZE を INDEX_PAGE_SIZE 相当(1000)に変えると、
// 101 件全部が 1 ページで返り next が 'end' になるため、このテストは落ちる。
it('SEARCH_PAGE_SIZE を超えるヒットは 100 件でページ分割される', async () => {
  const stub = indexOf('media');
  const indices = Array.from({ length: 101 }, (_, i) => i);
  for (const i of indices) {
    const key = `bulk/report-${`${i}`.padStart(3, '0')}.txt`;
    await stub.upsert(descriptorOf('media', key));
  }

  const res = await api.request('/buckets/media/search?q=report', {}, env);
  expect(res.status).toBe(200);

  const page = (await res.json()) as ObjectPage;
  expect(page.objects).toHaveLength(100);
  expect(page.next.kind).toBe('more');
});
