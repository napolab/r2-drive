import { BucketNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { Result } from 'neverthrow';

type BucketDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly binding: keyof Env;
  // 索引を信じるかどうかは deploy 時に決める(Phase 1 spec §6)。
  // Processor.run は同期なので「索引が ready か」を実行時に問い合わせられない。
  // バックフィル完了を status で確認してから true にして deploy する。
  readonly indexed: boolean;
};

// バケット追加は wrangler.jsonc に 1 行 + ここに 1 行 + 再デプロイ。
//
// photos は Task 11(2026-08-18)でバックフィル完了を status で確認してから true にした。
// 実測は reports/2026-08-18-phase-1-index-perf.md。
//
// **media は false のまま残す。**索引経路と R2 経路の両方が同時に生きていることを
// 実環境で検証し続けるための対照であり、受け入れ基準 3(indexed: false のバケットが
// Phase 0 と完全に同じ挙動をする)の回帰テストはこのバケットを使う。
// media を true にするときは、先に backfill を叩いて status が complete になることを
// 確認すること(手順は buckets/index.ts の /:bucketId/index/backfill のコメント)。
export const bucketDescriptors = [
  { id: 'photos', label: '写真', binding: 'BUCKET_PHOTOS', indexed: true },
  { id: 'media', label: 'メディア', binding: 'BUCKET_MEDIA', indexed: false },
] as const satisfies readonly BucketDescriptor[];

// registry からリテラル union を導出する。バケットを足すと型が自動で広がる。
export type BucketId = (typeof bucketDescriptors)[number]['id'];

export const resolveBucket = (env: Env, id: string): Result<R2Bucket, BucketNotFoundError> => {
  const descriptor = bucketDescriptors.find((d) => d.id === id);
  if (descriptor === undefined) return err(new BucketNotFoundError(id));
  const bucket = env[descriptor.binding];
  if (bucket === undefined) return err(new BucketNotFoundError(`binding missing: ${descriptor.binding}`));

  return ok(bucket as R2Bucket);
};
