import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

import type { ObjectPage } from '@r2-drive/core';

// **これは意図的な非対称である。**マーカーだけの(中身が無い)フォルダに対して、
// R2 経路(indexed: false = media)と索引経路(indexed: true = photos)は違う結果を返す。
//
// - R2 経路: delimitedPrefixes は R2 の list() が機械的に作るものなので、
//   0 バイトのマーカー(末尾 '/' のキー)だけでもフォルダとして出る
// - 索引経路: prefixes 行は remove で消さない設計(空フォルダを表現しない方針。
//   spec §4/§9)なので、object-index/index.ts の #foldersOf が「配下に objects が
//   1 件でも存在するか(マーカー自身を除く)」を EXISTS で確認してから返す(Ruling 2)。
//   マーカーしか無ければ EXISTS が偽になり、そのフォルダは一覧に出ない
//
// **これは修正しない。**spec §4/§9 が「空フォルダは表現しない」と明言しており、
// 索引側の挙動のほうが spec に忠実で、R2 側が事故に近いためである。
// **直しにいく前にここを読め。**直すなら R2 側であって索引側ではない(最終レビュー I1)。
describe('マーカーだけのフォルダ: R2 経路と索引経路の非対称(意図的、Ruling 24)', () => {
  it('R2 経路(media)はマーカーだけのフォルダをフォルダとして返す', async () => {
    await env.BUCKET_MEDIA.put('mk/empty/', '');

    const res = await api.request('/buckets/media/objects?prefix=mk%2F', {}, env);
    const page = (await res.json()) as ObjectPage;

    expect(page.folders).toEqual([{ bucketId: 'media', prefix: 'mk/empty/', name: 'empty' }]);
    expect(page.objects).toEqual([]);
  });

  it('索引経路(photos)は同じ形のマーカーだけのフォルダを一覧に出さない', async () => {
    // アップロード API を通す。索引に行を書く唯一の同期経路(uploads/index.ts の indexUpsert)。
    const uploaded = await api.request('/uploads/photos/single?key=mk%2Fempty%2F', { method: 'PUT', headers: { 'content-type': 'application/octet-stream' } }, env);
    expect(uploaded.status).toBe(200);

    const res = await api.request('/buckets/photos/objects?prefix=mk%2F', {}, env);
    const page = (await res.json()) as ObjectPage;

    expect(page.folders).toEqual([]);
    expect(page.objects).toEqual([]);
  });
});
