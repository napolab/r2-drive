import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { objectIndexNamespace } from './object-index-namespace';
import { waitForBackfill } from './wait-for-backfill';

import type { ObjectDescriptor } from '@r2-drive/core';

// I3: #indexPage の `bucket.list()` は R2 への往復を挟むので、その窓の間に live な
// remove() / upsert() が割り込める(DO の入力ゲートが開いている)。
// test/worker-entry.ts の ObjectIndexUnderTest.listBackfillPage override が、
// index.ts の protected seam を使ってこの窓を決定的に再現する
// (setBackfillRace で仕込んだ操作が 1 ページ目の list 直後・適用前にちょうど 1 回実行される)。
const indexOf = (name: string) => objectIndexNamespace.get(objectIndexNamespace.idFromName(name));

it('ゴースト行: list 後に live remove されたキーはバックフィルで復活しない', async () => {
  await env.BUCKET_PHOTOS.put('race-ghost/keep-a.txt', 'a');
  await env.BUCKET_PHOTOS.put('race-ghost/keep-b.txt', 'b');
  await env.BUCKET_PHOTOS.put('race-ghost/victim.txt', 'x');

  const stub = indexOf('race-ghost');
  await stub.setBackfillRace({ kind: 'remove', key: 'race-ghost/victim.txt' });
  await stub.startBackfill('photos');
  await waitForBackfill(stub);

  await expect(stub.status()).resolves.toMatchObject({ kind: 'complete' });
  // 消えたはずのキーが索引に復活していない(list 経路からも search 経路からも見えない)。
  await expect(stub.debugRow('race-ghost/victim.txt')).resolves.toBeUndefined();
  await expect(stub.debugFtsKeys()).resolves.not.toContain('race-ghost/victim.txt');
  // 割り込みに関係の無い他のキーは通常どおり索引される。
  await expect(stub.debugRow('race-ghost/keep-a.txt')).resolves.toMatchObject({ name: 'keep-a.txt' });
  await expect(stub.debugRow('race-ghost/keep-b.txt')).resolves.toMatchObject({ name: 'keep-b.txt' });
});

it('スケール上書き: list 後の live upsert より古いスナップショットで上書きしない', async () => {
  await env.BUCKET_PHOTOS.put('race-stale/target.txt', 'old');

  const stub = indexOf('race-stale');
  const fresher: ObjectDescriptor = {
    bucketId: 'photos',
    key: 'race-stale/target.txt',
    name: 'target.txt',
    contentType: 'text/plain',
    size: 999,
    uploadedAt: '2999-01-01T00:00:00.000Z',
    etag: 'fresher-etag',
  };
  await stub.setBackfillRace({ kind: 'upsert', descriptor: fresher });
  await stub.startBackfill('photos');
  await waitForBackfill(stub);

  await expect(stub.status()).resolves.toMatchObject({ kind: 'complete' });
  // live 側が書いた新しい etag / size が生き残っている。バックフィルの古いスナップ
  // ショットで上書きされていない。
  await expect(stub.debugRow('race-stale/target.txt')).resolves.toMatchObject({ etag: 'fresher-etag', size: 999 });
});

it('トゥームストーンはバックフィル完了で消え、以降の再アップロードは索引に反映される', async () => {
  await env.BUCKET_PHOTOS.put('race-tombstone/victim.txt', 'x');

  const stub = indexOf('race-tombstone');
  await stub.setBackfillRace({ kind: 'remove', key: 'race-tombstone/victim.txt' });
  await stub.startBackfill('photos');
  await waitForBackfill(stub);

  await expect(stub.debugRow('race-tombstone/victim.txt')).resolves.toBeUndefined();
  await expect(stub.debugTombstoneCount()).resolves.toBe(0);

  const revived: ObjectDescriptor = {
    bucketId: 'photos',
    key: 'race-tombstone/victim.txt',
    name: 'victim.txt',
    contentType: 'text/plain',
    size: 1,
    uploadedAt: new Date().toISOString(),
    etag: 'revived-etag',
  };
  await stub.upsert(revived);

  await expect(stub.debugRow('race-tombstone/victim.txt')).resolves.toMatchObject({ etag: 'revived-etag' });
});

it('バックフィルが走っていないときの remove() はトゥームストーンを書かない', async () => {
  const stub = indexOf('race-outside');
  const seeded: ObjectDescriptor = {
    bucketId: 'photos',
    key: 'race-outside/a.txt',
    name: 'a.txt',
    contentType: 'text/plain',
    size: 1,
    uploadedAt: new Date().toISOString(),
    etag: 'e',
  };
  await stub.upsert(seeded);
  await expect(stub.status()).resolves.toMatchObject({ kind: 'idle' });

  await stub.remove('race-outside/a.txt');

  await expect(stub.debugTombstoneCount()).resolves.toBe(0);
});
