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
    await expect(stub.debugRow('a.txt')).resolves.toEqual({
      key: 'a.txt',
      name: 'a.txt',
      parentPrefix: '',
      contentType: 'application/octet-stream',
      size: 999,
      uploadedAt: '2026-08-17T00:00:00.000Z',
      etag: '"new"',
    });
  });

  // Task 5 の一覧はこの parent_prefix でフォルダを引く。列の中身を見ないと
  // 「parentPrefix を定数に固定する」変異がテストをすり抜ける。
  it('objects の name / parent_prefix は key から導かれる', async () => {
    const stub = stubFor('write-row-columns');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugRow('a/b/c.txt')).resolves.toMatchObject({ name: 'c.txt', parentPrefix: 'a/b/' });
  });

  // 渡した name は保存されない(key から再計算する)。矛盾した name を渡しても
  // 索引は key に従うことを固定する。
  it('descriptor の name が key と矛盾していても key 由来の name が入る', async () => {
    const stub = stubFor('write-row-name-ignored');
    await stub.upsert(descriptorOf('a/b/c.txt', { name: 'ウソの名前.txt' }));

    await expect(stub.debugRow('a/b/c.txt')).resolves.toMatchObject({ name: 'c.txt' });
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
});

describe('ObjectIndex の prefixes', () => {
  it('upsert が祖先 prefix を prefixes 表に入れる', async () => {
    const stub = stubFor('write-prefixes');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([
      { prefix: 'a/', parentPrefix: '' },
      { prefix: 'a/b/', parentPrefix: 'a/' },
    ]);
  });

  // 深い階層。prefixes の parent_prefix が「1 つ上の prefix」に連鎖することを見る。
  it('3 階層の祖先 prefix が親を辿れる形で入る', async () => {
    const stub = stubFor('write-prefixes-deep');
    await stub.upsert(descriptorOf('a/b/c/d.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([
      { prefix: 'a/', parentPrefix: '' },
      { prefix: 'a/b/', parentPrefix: 'a/' },
      { prefix: 'a/b/c/', parentPrefix: 'a/b/' },
    ]);
  });

  it('祖先 prefix は重複しても 1 行のまま', async () => {
    const stub = stubFor('write-prefixes-dedup');
    await stub.upsert(descriptorOf('a/b/c.txt'));
    await stub.upsert(descriptorOf('a/b/d.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([
      { prefix: 'a/', parentPrefix: '' },
      { prefix: 'a/b/', parentPrefix: 'a/' },
    ]);
  });

  it('ルート直下のオブジェクトは prefixes に何も入れない', async () => {
    const stub = stubFor('write-prefixes-root');
    await stub.upsert(descriptorOf('a.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([]);
  });
});

// spec §8 が「本命の防波堤」と呼ぶ整合性。objects と objects_fts が同じ書き込みで
// 動くこと(FTS だけ書き忘れない)を positive 側から張る。
// ロールバックの証明には失敗注入が要るので、そちらは別タスクに送っている。
describe('ObjectIndex と objects_fts の整合性', () => {
  it('upsert した key は FTS からも引ける', async () => {
    const stub = stubFor('fts-upsert');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugFtsKeys()).resolves.toEqual(['a/b/c.txt']);
  });

  it('FTS は name で MATCH できる', async () => {
    const stub = stubFor('fts-match');
    await stub.upsert(descriptorOf('photos/vacation-2026.jpg'));
    await stub.upsert(descriptorOf('docs/invoice-2026.pdf'));

    await expect(stub.debugFtsSearch('vacation')).resolves.toEqual(['photos/vacation-2026.jpg']);
  });

  it('同じ key を 2 回 upsert しても FTS の行は増えない', async () => {
    const stub = stubFor('fts-upsert-twice');
    await stub.upsert(descriptorOf('a.txt', { size: 1 }));
    await stub.upsert(descriptorOf('a.txt', { size: 2 }));

    await expect(stub.debugFtsKeys()).resolves.toEqual(['a.txt']);
  });

  it('remove した key は FTS からも消える', async () => {
    const stub = stubFor('fts-remove');
    await stub.upsert(descriptorOf('a.txt'));
    await stub.upsert(descriptorOf('b.txt'));
    await stub.remove('a.txt');

    await expect(stub.debugFtsKeys()).resolves.toEqual(['b.txt']);
  });
});

// 1 バケット = 1 DO は idFromName(bucketId) を呼ぶ側の不変条件でしかない。
// 誤ルーティングを静かに成功させない(Ruling 11)。
describe('ObjectIndex のバケット guard', () => {
  it('同じ bucketId の upsert は続けられる', async () => {
    const stub = stubFor('bucket-guard-same');
    await stub.upsert(descriptorOf('a.txt', { bucketId: 'photos' }));
    await stub.upsert(descriptorOf('b.txt', { bucketId: 'photos' }));

    await expect(stub.count()).resolves.toBe(2);
  });

  it('別の bucketId の upsert は例外になる', async () => {
    const stub = stubFor('bucket-guard-mismatch');
    await stub.upsert(descriptorOf('a.txt', { bucketId: 'photos' }));

    await expect(async () => stub.upsert(descriptorOf('b.txt', { bucketId: 'media' }))).rejects.toThrow(/bound to bucket "photos" but received "media"/);
  });

  it('拒否された upsert は 1 行も書かない', async () => {
    const stub = stubFor('bucket-guard-no-write');
    await stub.upsert(descriptorOf('a.txt', { bucketId: 'photos' }));
    await expect(async () => stub.upsert(descriptorOf('x/y.txt', { bucketId: 'media' }))).rejects.toThrow();

    await expect(stub.count()).resolves.toBe(1);
    await expect(stub.debugPrefixes()).resolves.toEqual([]);
    await expect(stub.debugFtsKeys()).resolves.toEqual(['a.txt']);
  });
});
