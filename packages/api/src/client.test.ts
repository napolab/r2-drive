import { createExecutionContext, env } from 'cloudflare:test';
import { NetworkError, ObjectNotFoundError, UploadSessionError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { api } from './index';

import { createApiClient, request, toDriveError } from './client';

import type { ApiTransport } from './client';

// このテストファイルは packages/api の内部なので、api(Hono アプリの値)を相対 import
// してよい(.oxlintrc.json の no-restricted-imports は @r2-drive/api というパッケージ
// specifier だけを禁じており、apps/web/src/worker.ts に閉じ込めるための規約)。
// ssr トランスポートの fetch を組み立てるのは、本来は worker.ts / loader 側の責務。
// ここではネットワークを経由せず Hono を直接呼ぶことをテストで示すために同じ形を再現する。
const ssrTransport = (): ApiTransport => ({
  kind: 'ssr',
  origin: 'http://localhost',
  // Hono の api.fetch は Response | Promise<Response> を返す。global fetch の型
  // (typeof fetch)は常に Promise<Response> を要求するため Promise.resolve で揃える。
  fetch: (input, init) => Promise.resolve(api.fetch(new Request(input, init), env, createExecutionContext())),
});

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
    const client = createApiClient(ssrTransport());

    const page = (await request(() => client.buckets[':bucketId'].objects.$get({ param: { bucketId: 'photos' }, query: {} })))._unsafeUnwrap();

    expect(page.objects.map((o) => o.key)).toEqual(['a.txt']);
  });

  it('非 2xx を DriveError に落とす', async () => {
    const client = createApiClient(ssrTransport());

    const result = await request(() => client.buckets[':bucketId'].objects.$get({ param: { bucketId: 'nope' }, query: {} }));

    expect(result._unsafeUnwrapErr().name).toBe('BucketNotFoundError');
  });
});

describe('request — toDriveError が例外を投げる error body でも Err を返す(Result チャンネルを脱出しない)', () => {
  it('zValidator のバリデーション失敗 body({ success: false, error }、name を持たない)を例外ではなく Err に変換する', async () => {
    const client = createApiClient(ssrTransport());

    // uploads の json body バリデーション(key: z.string().min(1))を空文字で落とす。
    // @hono/zod-validator は c.json({ success: false, error }, 400) を返す — name フィールドが
    // 無いため toDriveError の switch は default に落ちて throw する経路を通る。
    const result = await request(() => client.uploads[':bucketId'].$post({ param: { bucketId: 'photos' }, json: { key: '', contentType: 'text/plain' } }));

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NetworkError);
  });
});
