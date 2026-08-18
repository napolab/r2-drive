import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { listCursor, searchCursor } from '../../../object-index/cursor/index';
import { ForeignCursorError } from '../../../object-index/errors';

import { r2ListSource } from './index';

import type { ListRequest } from '../types';

const requestFor = (cursor: string | undefined): ListRequest => ({ env, bucketId: 'media', prefix: '', cursor });

// Ruling 23: R2 は不正な cursor を弾かない。
//
// 実測(2026-08-18、miniflare 上、`packages/api` の実 R2 binding 相手):
// `list({ prefix: 'pf/', cursor: 'q1:pf/1.txt' })` は **例外を投げず**
// `objects: []` / `truncated: false` を返す。listObjects はそれを
// `next: { kind: 'end' }` に畳むので、**一覧が静かに「ここで終わり」になる。**
// 索引側(Ruling 18)で塞いだのと同じ失敗クラスの裏返しなので、こちらでも弾く。
describe('r2ListSource の foreign cursor 拒否(Ruling 23)', () => {
  // 前提の固定。この行が落ちたら R2 側の挙動が変わったということなので、
  // ガード自体の要否から考え直すこと。
  it('前提: R2 の list はタグ付き cursor を例外にせず空ページを返す', async () => {
    await env.BUCKET_MEDIA.put('pf/1.txt', 'x');
    await env.BUCKET_MEDIA.put('pf/2.txt', 'x');

    const listed = await env.BUCKET_MEDIA.list({ prefix: 'pf/', delimiter: '/', limit: 1000, cursor: 'q1:pf/1.txt' });

    expect(listed.objects).toEqual([]);
    expect(listed.truncated).toBe(false);
  });

  it('検索が発行した cursor を渡すと ForeignCursorError になる', async () => {
    const result = r2ListSource.run(requestFor(searchCursor.encode('pf/1.txt')));

    expect(result.isOk()).toBe(true);
    const outcome = await result._unsafeUnwrap();
    expect(outcome._unsafeUnwrapErr().cause).toBeInstanceOf(ForeignCursorError);
  });

  it('索引の一覧が発行した cursor も拒否する', async () => {
    const outcome = await r2ListSource.run(requestFor(listCursor.encode('pf/1.txt')))._unsafeUnwrap();

    expect(outcome._unsafeUnwrapErr().cause).toBeInstanceOf(ForeignCursorError);
  });

  // 拒否が広すぎないことの対照。R2 が発行した本物の形(base64)は素通しする。
  it('R2 の opaque cursor は素通しする', async () => {
    await env.BUCKET_MEDIA.put('pass/1.txt', 'x');

    const outcome = await r2ListSource.run({ env, bucketId: 'media', prefix: 'pass/', cursor: 'cGFzcy8xLnR4dA==' })._unsafeUnwrap();

    expect(outcome.isOk()).toBe(true);
  });

  it('cursor が無い一覧は素通しする', async () => {
    const outcome = await r2ListSource.run(requestFor(undefined))._unsafeUnwrap();

    expect(outcome.isOk()).toBe(true);
  });
});
