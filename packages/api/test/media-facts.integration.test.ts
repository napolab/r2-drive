import { NO_MEDIA } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { objectIndexNamespace } from './object-index-namespace';

import type { ObjectDescriptor } from '@r2-drive/core';

// DO 直叩きパターン(index-sync.integration.test.ts / foreign-cursor.integration.test.ts と同じ流儀)。
// DO インスタンス名(idFromName の引数)をテストごとに変えて隔離する。ObjectDescriptor.bucketId は
// 常に 'photos' 固定でよい(#bindBucket は idFromName の名前とは無関係に、初回 upsert の bucketId を
// 記録するだけ)。
const objectIndexStub = (doName: string) => objectIndexNamespace.get(objectIndexNamespace.idFromName(doName));

const descriptor = (key: string, media: ObjectDescriptor['media'] = NO_MEDIA): ObjectDescriptor => ({
  bucketId: 'photos',
  key,
  name: key,
  contentType: 'image/png',
  size: 1,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
  media,
});

describe('MediaFacts の索引列', () => {
  it('media: image 付きの upsert は列に書き、list が variant で返す', async () => {
    const stub = objectIndexStub('photos-media-1');
    await stub.upsert(descriptor('a.png', { kind: 'image', width: 800, height: 600 }));
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 800, height: 600 });
  });

  it('media: none の upsert 後、setMediaFacts で後から埋められる', async () => {
    const stub = objectIndexStub('photos-media-2');
    await stub.upsert(descriptor('b.png'));
    await stub.setMediaFacts('b.png', 1920, 1080);
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 1920, height: 1080 });
  });

  it('setMediaFacts は行が無ければ何もしない(削除との競合に安全)', async () => {
    const stub = objectIndexStub('photos-media-3');
    await stub.setMediaFacts('missing.png', 10, 10); // throw しない
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects).toEqual([]);
  });

  it('media 無しの upsert が既存の寸法を消さない(索引書き直しで寸法が退行しない)', async () => {
    const stub = objectIndexStub('photos-media-4');
    await stub.upsert(descriptor('c.png', { kind: 'image', width: 800, height: 600 }));
    await stub.upsert(descriptor('c.png')); // 再アップロード相当、寸法未知
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 800, height: 600 });
  });
});
