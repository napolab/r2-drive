import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { BACKFILL_PAGES_KEY } from '../src/object-index/index';

import { objectIndexNamespace } from './object-index-namespace';
import { waitForBackfill } from './wait-for-backfill';

// バックフィルの「途中で止まっても続きから進み、最終的に全件揃う」契約は、ページ境界を
// 実際にまたがないと踏めない。1 ページは 1000 件(実測 2026-08-18、miniflare 上:
// include を付けない list({ limit: 1000 }) は 1000 件、include: ['httpMetadata'] を
// 付けると R2 がレスポンス量で打ち切って 100 件に丸める)なので、このファイルだけ
// 1001 件置いて 2 ページにする。
//
// vitest-pool-workers のストレージ分離はファイル単位なので、この 1001 件は他の
// テストファイルからは見えない。バックフィルはバケット全体を舐めるため、件数の
// 絶対値を張るこのテストは専用ファイルに隔離する必要がある。
const TOTAL = 1001;

// 1001 回の put を直列に待つと遅いので 50 件ずつ束ねる。アップロード API を経由せず
// R2 に直接置くので、索引には 1 件も入っていない状態から始まる。
const seed = async (): Promise<void> => {
  const keys = Array.from({ length: TOTAL }, (_, i) => `page/${`${i}`.padStart(5, '0')}.txt`);
  const batches = Array.from({ length: Math.ceil(keys.length / 50) }, (_, i) => keys.slice(i * 50, i * 50 + 50));
  for (const batch of batches) await Promise.all(batch.map(async (key) => env.BUCKET_PHOTOS.put(key, 'x')));
};

// カーソルの保存を消すと、2 ページ目以降が毎回先頭 1000 件を舐め直して truncated の
// まま次の alarm を予約し続ける。行数は 1000 で止まり complete に到達しないので、
// waitForBackfill のポーリング上限で落ちる。1 ページに収まるデータではこの変異を
// 一切検出できない(1 回で truncated: false になるためカーソルを保存しないので)。
it('1 ページを超えるバケットをカーソルで継いで全件取り込む', async () => {
  await seed();
  const stub = objectIndexNamespace.get(objectIndexNamespace.idFromName('backfill-pagination'));

  await stub.startBackfill('photos');
  await waitForBackfill(stub);

  await expect(stub.status()).resolves.toEqual({ kind: 'complete', indexed: TOTAL, mediaPending: 0 });
  // 2 ページ目の先頭。1 ページ目だけで終わる実装だとこの行が存在しない。
  await expect(stub.debugRow('page/01000.txt')).resolves.toMatchObject({ name: '01000.txt', parentPrefix: 'page/' });

  // **Ruling 20 の「include を付けない」を張る唯一の場所。**1001 件が 2 ページで
  // 収まったということは 1 ページ 1000 件だったということである。
  // include: ['httpMetadata'] を付け直すと 1 ページ 100 件に丸められて 11 ページになる。
  // 速度にしか現れない退行なので、テスト時間でもタイムアウトでも検出できない
  // (レビューで実測: include ありでも 153 tests 全部 pass、実行時間はむしろ短く出た)。
  // 最終状態に残るページ数だけが決定的に捕まえられる。
  await expect(stub.debugMeta(BACKFILL_PAGES_KEY)).resolves.toBe('2');
}, 60_000);
