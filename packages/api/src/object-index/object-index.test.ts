import { describe, expect, it } from 'vitest';

import { objectIndexNamespace } from '../../test/object-index-namespace';

import type { ObjectDescriptor } from '@r2-drive/core';

const descriptorOf = (key: string, overrides: Partial<ObjectDescriptor> = {}): ObjectDescriptor => ({
  bucketId: 'photos',
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  contentType: 'application/octet-stream',
  size: 10,
  uploadedAt: '2026-08-17T00:00:00.000Z',
  etag: `"etag-${key}"`,
  ...overrides,
});

// テストごとに別 DO を使う。vitest-pool-workers のストレージ分離はファイル単位なので、
// 同一ファイル内のテスト間で書き込みは巻き戻らない。
const stubFor = (name: string) => objectIndexNamespace.get(objectIndexNamespace.idFromName(name));

describe('ObjectIndex の書き込み', () => {
  it('upsert したオブジェクトが数えられる', async () => {
    const stub = stubFor('write-count');
    await stub.upsert(descriptorOf('a.txt'));
    await stub.upsert(descriptorOf('photos/b.jpg'));

    await expect(stub.count()).resolves.toBe(2);
  });

  it('同じ key の upsert は行を増やさず内容を置き換える', async () => {
    const stub = stubFor('write-upsert');
    await stub.upsert(descriptorOf('a.txt', { size: 10, etag: '"old"' }));
    await stub.upsert(descriptorOf('a.txt', { size: 999, etag: '"new"' }));

    await expect(stub.count()).resolves.toBe(1);
    await expect(stub.debugRow('a.txt')).resolves.toMatchObject({ size: 999, etag: '"new"' });
  });

  it('remove で行が消える', async () => {
    const stub = stubFor('write-remove');
    await stub.upsert(descriptorOf('a.txt'));
    await stub.remove('a.txt');

    await expect(stub.count()).resolves.toBe(0);
  });

  it('存在しない key の remove は例外にならない', async () => {
    const stub = stubFor('write-remove-missing');

    await expect(stub.remove('nope.txt')).resolves.toBeUndefined();
  });

  it('upsert が祖先 prefix を prefixes 表に入れる', async () => {
    const stub = stubFor('write-prefixes');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual(['a/', 'a/b/']);
  });

  it('祖先 prefix は重複しても 1 行のまま', async () => {
    const stub = stubFor('write-prefixes-dedup');
    await stub.upsert(descriptorOf('a/b/c.txt'));
    await stub.upsert(descriptorOf('a/b/d.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual(['a/', 'a/b/']);
  });
});
