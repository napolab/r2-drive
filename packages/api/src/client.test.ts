import { createExecutionContext, env } from 'cloudflare:test';
import { ObjectNotFoundError, UploadSessionError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { createApiClient, request, toDriveError } from './client';

describe('toDriveError', () => {
  it('name からクラスを復元する', () => {
    expect(toDriveError({ name: 'ObjectNotFoundError', message: 'a.txt' })).toBeInstanceOf(ObjectNotFoundError);
  });

  it('UploadSessionError は reason を保つ', () => {
    const restored = toDriveError({ name: 'UploadSessionError', message: 'x', reason: 'part-too-small' });

    expect(restored).toBeInstanceOf(UploadSessionError);
    expect((restored as UploadSessionError).reason).toBe('part-too-small');
  });
});

describe('createApiClient (ssr)', () => {
  it('ネットワークを経由せず Hono を直接呼ぶ', async () => {
    await env.BUCKET_PHOTOS.put('a.txt', 'a');
    const client = createApiClient({
      kind: 'ssr',
      origin: 'http://localhost',
      env,
      ctx: createExecutionContext(),
      headers: new Headers(),
    });

    const page = (await request(() => client.buckets[':bucketId'].objects.$get({ param: { bucketId: 'photos' }, query: {} })))._unsafeUnwrap();

    expect(page.objects.map((o) => o.key)).toEqual(['a.txt']);
  });

  it('非 2xx を DriveError に落とす', async () => {
    const client = createApiClient({
      kind: 'ssr',
      origin: 'http://localhost',
      env,
      ctx: createExecutionContext(),
      headers: new Headers(),
    });

    const result = await request(() => client.buckets[':bucketId'].objects.$get({ param: { bucketId: 'nope' }, query: {} }));

    expect(result._unsafeUnwrapErr().name).toBe('BucketNotFoundError');
  });
});
