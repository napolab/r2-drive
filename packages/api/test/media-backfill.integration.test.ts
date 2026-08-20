import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { PNG_1x1 } from './fixtures/images';
import { objectIndexNamespace } from './object-index-namespace';
import { waitForBackfill } from './wait-for-backfill';

// DO 直叩きパターン(media-facts.integration.test.ts / backfill-race.integration.test.ts と同じ流儀)。
// DO インスタンス名(idFromName の引数)をテストごとに変えて隔離する。
const objectIndexStub = (doName: string) => objectIndexNamespace.get(objectIndexNamespace.idFromName(doName));

describe('media 追い掛けフェーズ', () => {
  it('バックフィルで拾った既存画像の寸法が追い掛けで埋まる', async () => {
    // R2 に直接 put(= 索引を経由しない既存オブジェクト)
    await env.BUCKET_PHOTOS.put('chase/a.png', PNG_1x1);
    await env.BUCKET_PHOTOS.put('chase/b.txt', 'not an image');

    const stub = objectIndexStub('photos-chase-1');
    await stub.startBackfill('photos');
    await waitForBackfill(stub); // media フェーズ完了まで待つ形に拡張済み

    const page = await stub.list({ bucketId: 'photos', prefix: 'chase/', cursor: undefined, limit: 10 });
    const a = page.objects.find((o) => o.key === 'chase/a.png');
    const b = page.objects.find((o) => o.key === 'chase/b.txt');
    expect(a?.media).toEqual({ kind: 'image', width: 1, height: 1 });
    expect(b?.media).toEqual({ kind: 'none' });
  });

  it('status が media 残件数を報告する', async () => {
    // 起動直後(索引フェーズ complete 直後)に mediaPending > 0 を観測するのは
    // alarm 自動発火とレースするため、最終状態のみ固定する:
    const stub = objectIndexStub('photos-chase-1');
    const status = await stub.status();
    expect(status).toEqual({ kind: 'complete', indexed: expect.any(Number), mediaPending: 0 });
  });
});
