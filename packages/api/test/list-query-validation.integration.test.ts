import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

// GET /buckets/:bucketId/objects の prefix バリデーション。
//
// R2 経路(r2/list.ts の listObjects)は R2.list({ prefix, delimiter: '/' }) に
// prefix をそのまま渡すので、末尾 '/' が無くても前方一致で 1 件返る。
// 一方、索引経路(object-index/index.ts の list)は
// `eq(objects.parentPrefix, input.prefix)` の完全一致で、objects.parentPrefix は
// keyPartsOf の設計上必ず '/' 終わりか空文字なので、末尾 '/' の無い prefix には
// 永久にマッチしない(0 件)。**同じ入力に対して 2 経路が違う件数を返す**ため、
// buckets/index.ts の listQuery に .refine を足して両経路とも 400 で揃えた
// (最終レビュー M1)。バケットはどちらでもよいが、ここでは media(R2 経路)を使う。
describe('GET /buckets/:bucketId/objects の prefix バリデーション', () => {
  it('末尾が "/" でない prefix は 400 を返す', async () => {
    await env.BUCKET_MEDIA.put('ab/c.txt', 'x');

    const res = await api.request('/buckets/media/objects?prefix=ab', {}, env);

    expect(res.status).toBe(400);
  });

  it('末尾が "/" の prefix は 200 を返す(正常系が壊れていないことの確認)', async () => {
    await env.BUCKET_MEDIA.put('ab/c.txt', 'x');

    const res = await api.request('/buckets/media/objects?prefix=ab%2F', {}, env);

    expect(res.status).toBe(200);
  });

  it('空文字の prefix(既定値)は 200 を返す', async () => {
    const res = await api.request('/buckets/media/objects', {}, env);

    expect(res.status).toBe(200);
  });
});
