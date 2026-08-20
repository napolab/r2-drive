import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { objectIndexNamespace } from './object-index-namespace';
import { waitForBackfill } from './wait-for-backfill';

// I3 の競合窓は 1 ページ目に限らない。#indexPage は複数ページに跨って alarm を
// 予約し直すため(backfill-pagination.integration.test.ts が固定している契約)、
// 「2 ページ目以降のスナップショットを取った直後」にも同じ窓が開く。1 ページに
// 収まるテスト(backfill-race.integration.test.ts)だけでは、この窓が 1 ページ目
// でしか踏めていない。ここでは 1 ページ(BACKFILL_PAGE=1000 件)を超えるバケットを
// 用意し、ちょうど 2 ページ目の list 直後に割り込みを発火させて、同じ防御(トゥーム
// ストーン)がページ番号に関係なく効くことを固定する。
//
// vitest-pool-workers のストレージ分離はファイル単位(backfill-pagination.integration
// .test.ts のコメント参照)なので、絶対件数を張るこのテストも専用ファイルに隔離する。
const TOTAL = 1005;

// 5 桁ゼロ埋めで R2 の辞書順と数値順を一致させる(backfill-pagination.integration.test.ts
// と同じ組み立て方)。BACKFILL_PAGE=1000 なので 1 ページ目は 00000〜00999、
// 2 ページ目は 01000〜01004 の 5 件になる。
const keys = Array.from({ length: TOTAL }, (_, i) => `race-pagination/${`${i}`.padStart(5, '0')}.txt`);

const seed = async (): Promise<void> => {
  const batches = Array.from({ length: Math.ceil(keys.length / 50) }, (_, i) => keys.slice(i * 50, i * 50 + 50));
  for (const batch of batches) await Promise.all(batch.map(async (key) => env.BUCKET_PHOTOS.put(key, 'x')));
};

it('2 ページ目の list 後に live remove されたキーは複数ページに跨るバックフィルでもゴースト行にならない', async () => {
  await seed();

  const victim = keys[TOTAL - 1];
  const firstPageKey = keys[0];
  const lastSurvivingSecondPageKey = keys[TOTAL - 2];
  if (victim === undefined || firstPageKey === undefined || lastSurvivingSecondPageKey === undefined) {
    throw new Error('seed key が想定より少ない');
  }

  const stub = objectIndexNamespace.get(objectIndexNamespace.idFromName('race-pagination'));
  // victim(race-pagination/01004.txt)は 2 ページ目の最後の要素。atCall: 2 で
  // 「2 ページ目の list 直後・適用前」にだけ発火させる。
  await stub.setBackfillRace({ kind: 'remove', key: victim, atCall: 2 });
  await stub.startBackfill('photos');
  await waitForBackfill(stub);

  // TDD sense-check: このテストが実際に 2 ページ目まで到達していなければ、割り込みは
  // 一度も発火せず「何も検証していないテスト」になる。到達を直接確認する。
  await expect(stub.debugBackfillPageCalls()).resolves.toBe(2);

  await expect(stub.status()).resolves.toEqual({ kind: 'complete', indexed: TOTAL - 1, mediaPending: 0 });
  // 割り込みで消された 2 ページ目のキーは復活していない。
  await expect(stub.debugRow(victim)).resolves.toBeUndefined();
  // 1 ページ目・2 ページ目それぞれの生存キーは両方とも索引されている。
  await expect(stub.debugRow(firstPageKey)).resolves.toMatchObject({ key: firstPageKey });
  await expect(stub.debugRow(lastSurvivingSecondPageKey)).resolves.toMatchObject({ key: lastSurvivingSecondPageKey });
  // トゥームストーンは完了で片付いている(単一ページ版と同じ契約)。
  await expect(stub.debugTombstoneCount()).resolves.toBe(0);
}, 60_000);
