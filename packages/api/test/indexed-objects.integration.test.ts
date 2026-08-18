import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

import type { ObjectPage } from '@r2-drive/core';

// Task 11(2026-08-18)で photos が indexed: true になったので、一覧の HTTP の口が
// 索引経路を通ることをここで固定する。R2 経路側の回帰は objects.integration.test.ts が
// media(indexed: false)で見ている。**この 2 ファイルは対になっている。**
//
// アップロード API を通すのは、それが索引に行を書く唯一の同期経路だから
// (uploads/index.ts の indexUpsert)。R2 binding に直接置いたものは索引に入らない。
const upload = (bucketId: string, key: string, contentType: string) =>
  api.request(`/uploads/${bucketId}/single?key=${encodeURIComponent(key)}`, { method: 'PUT', body: 'xyz', headers: { 'content-type': contentType } }, env);

const list = async (bucketId: string, query: string): Promise<{ readonly status: number; readonly page: ObjectPage }> => {
  const res = await api.request(`/buckets/${bucketId}/objects${query}`, {}, env);

  return { status: res.status, page: (await res.json()) as ObjectPage };
};

describe('GET /buckets/photos/objects(indexed: true = 索引経路)', () => {
  it('アップロードしたオブジェクトが索引経路の一覧に出る', async () => {
    await upload('photos', 'idx/a.txt', 'text/plain');
    await upload('photos', 'idx/sub/b.md', 'text/markdown');

    const { status, page } = await list('photos', '?prefix=idx%2F');

    expect(status).toBe(200);
    expect(page.objects.map((o) => o.key)).toEqual(['idx/a.txt']);
    expect(page.folders.map((f) => f.prefix)).toEqual(['idx/sub/']);
    expect(page.next).toEqual({ kind: 'end' });
  });

  // **R2 が真実だが、索引はそれを自動で追わない。**R2 に直接置かれたオブジェクトは
  // バックフィルを叩くまで索引経路の一覧に出ない。これは欠陥ではなく Phase 1 の設計
  // (spec §7 がバックフィルを用意している理由)なので、挙動として固定しておく。
  // ここが黙って「出る」ようになったら、それは索引が別経路で書かれている証拠である。
  it('R2 に直接置いたオブジェクトはバックフィルまで索引経路に出ない', async () => {
    await env.BUCKET_PHOTOS.put('direct/only-in-r2.txt', 'x');

    const { page } = await list('photos', '?prefix=direct%2F');

    expect(page.objects).toEqual([]);
  });

  // Ruling 18 を一覧の口で固定する(検索側は foreign-cursor.integration.test.ts)。
  // 切り替え deploy を跨いだクライアントが握っている R2 の opaque cursor がこれ。
  it('R2 の opaque cursor を一覧に渡すと 412 を返す', async () => {
    const res = await api.request('/buckets/photos/objects?prefix=idx%2F&cursor=eyJrIjoiaWR4L2EudHh0In0', {}, env);

    expect(res.status).toBe(412);
    expect(await res.json()).toEqual({ name: 'PreconditionFailedError', message: 'cursor was not issued by the object index list route' });
  });
});
