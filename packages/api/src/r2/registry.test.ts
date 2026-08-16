import { env } from 'cloudflare:test';
import { BucketNotFoundError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { bucketDescriptors, resolveBucket } from './registry';

describe('resolveBucket', () => {
  it('登録済みの id から R2Bucket を返す', () => {
    const result = resolveBucket(env, 'photos');

    expect(result.isOk()).toBe(true);
  });

  it('未登録の id は BucketNotFoundError', () => {
    const result = resolveBucket(env, 'nope');

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BucketNotFoundError);
  });

  it('全ての descriptor が実在する binding を指している', () => {
    const missing = bucketDescriptors.filter((d) => env[d.binding] === undefined);

    expect(missing).toEqual([]);
  });
});
