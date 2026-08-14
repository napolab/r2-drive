import { BucketNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { Result } from 'neverthrow';

type BucketDescriptor = { readonly id: string; readonly label: string; readonly binding: keyof Env };

// バケット追加は wrangler.jsonc に 1 行 + ここに 1 行 + 再デプロイ。
export const bucketDescriptors = [
  { id: 'photos', label: '写真', binding: 'BUCKET_PHOTOS' },
  { id: 'media', label: 'メディア', binding: 'BUCKET_MEDIA' },
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
