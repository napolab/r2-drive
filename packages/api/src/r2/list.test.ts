import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { listObjects } from './list';

import type { ObjectPage, Prefix } from '@r2-drive/core';

type ListArgs = { readonly prefix: Prefix; readonly cursor: string | undefined; readonly limit: number };

// listObjects の戻り型がそのまま ObjectPage なので、テスト側に型アサーションを持ち込まない。
const listPage = async (args: ListArgs): Promise<ObjectPage> => {
  const result = await listObjects({ bucket: env.BUCKET_PHOTOS, bucketId: 'photos', ...args });

  return result._unsafeUnwrap();
};

// カーソルを辿り切るまで再帰する。`let` を使わずにページを繋ぐ。
const collectKeys = async (args: ListArgs, acc: readonly string[]): Promise<readonly string[]> => {
  const page = await listPage(args);
  const keys = [...acc, ...page.objects.map((object) => object.key)];
  if (page.next.kind === 'end') return keys;

  return collectKeys({ ...args, cursor: page.next.cursor }, keys);
};

describe('listObjects', () => {
  beforeEach(async () => {
    await Promise.all([env.BUCKET_PHOTOS.put('paged/a.txt', 'a'), env.BUCKET_PHOTOS.put('paged/b.txt', 'b'), env.BUCKET_PHOTOS.put('paged/c.txt', 'c')]);
  });

  it('limit が 1 ページの件数を決める', async () => {
    const page = await listPage({ prefix: 'paged/', cursor: undefined, limit: 2 });

    expect(page.objects).toHaveLength(2);
  });

  it('limit より多いと next は more になり cursor を返す', async () => {
    const page = await listPage({ prefix: 'paged/', cursor: undefined, limit: 2 });

    expect(page.next.kind).toBe('more');
  });

  it('返ってきた cursor を渡すと続きが返る', async () => {
    const first = await listPage({ prefix: 'paged/', cursor: undefined, limit: 2 });
    if (first.next.kind !== 'more') throw new Error('1 ページ目が truncated になっていない');

    const second = await listPage({ prefix: 'paged/', cursor: first.next.cursor, limit: 2 });

    expect(second.objects.map((object) => object.key)).toEqual(['paged/c.txt']);
  });

  it('最後のページは next が end になる', async () => {
    const first = await listPage({ prefix: 'paged/', cursor: undefined, limit: 2 });
    if (first.next.kind !== 'more') throw new Error('1 ページ目が truncated になっていない');

    const second = await listPage({ prefix: 'paged/', cursor: first.next.cursor, limit: 2 });

    expect(second.next).toEqual({ kind: 'end' });
  });

  it('全ページを繋ぐと投入した全キーが重複なく揃う', async () => {
    const keys = await collectKeys({ prefix: 'paged/', cursor: undefined, limit: 2 }, []);

    expect([...keys].sort()).toEqual(['paged/a.txt', 'paged/b.txt', 'paged/c.txt']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('limit 以内なら 1 ページで end になる', async () => {
    const page = await listPage({ prefix: 'paged/', cursor: undefined, limit: 10 });

    expect(page.objects).toHaveLength(3);
    expect(page.next).toEqual({ kind: 'end' });
  });

  it('contentType は保存済み httpMetadata ではなく拡張子から決まる', async () => {
    // include: ['httpMetadata'] を外した代償。R2 に text/plain で保存しても拡張子が勝つ。
    await env.BUCKET_PHOTOS.put('typed/photo.jpg', 'x', { httpMetadata: { contentType: 'text/plain' } });

    const page = await listPage({ prefix: 'typed/', cursor: undefined, limit: 10 });

    expect(page.objects.map((object) => object.contentType)).toEqual(['image/jpeg']);
  });

  it('拡張子が無ければ application/octet-stream', async () => {
    await env.BUCKET_PHOTOS.put('untyped/readme', 'x');

    const page = await listPage({ prefix: 'untyped/', cursor: undefined, limit: 10 });

    expect(page.objects.map((object) => object.contentType)).toEqual(['application/octet-stream']);
  });

  it('delimiter で共通接頭辞がフォルダに集約される', async () => {
    await Promise.all([env.BUCKET_PHOTOS.put('tree/leaf.txt', 'leaf'), env.BUCKET_PHOTOS.put('tree/nested/deep.txt', 'deep')]);

    const page = await listPage({ prefix: 'tree/', cursor: undefined, limit: 10 });

    expect(page.folders.map((folder) => ({ prefix: folder.prefix, name: folder.name }))).toEqual([{ prefix: 'tree/nested/', name: 'nested' }]);
    expect(page.objects.map((object) => object.key)).toEqual(['tree/leaf.txt']);
  });
});
