import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cloudflareAccessIdentity } from './cloudflare-access';

const encodeBase64Url = (payload: unknown): string => btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 署名は検証しないので中身はダミーで良い。ヘッダ.ペイロード.署名 の 3 パートだけ揃える。
const makeJwt = (payload: Record<string, unknown>): string => `header.${encodeBase64Url(payload)}.signature`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloudflareAccessIdentity', () => {
  it('common_name を持つペイロードは service Identity になる', async () => {
    const provider = cloudflareAccessIdentity(env);
    const request = new Request('http://localhost/', {
      headers: { 'Cf-Access-Jwt-Assertion': makeJwt({ common_name: 'ci-bot' }) },
    });

    const identity = (await provider.resolve(request))._unsafeUnwrap();

    expect(identity).toEqual({ kind: 'service', id: 'ci-bot', commonName: 'ci-bot' });
  });

  it('get-identity が name を返さなければ displayName は email にフォールバックする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ groups: [] }), { status: 200 })),
    );
    const provider = cloudflareAccessIdentity(env);
    const request = new Request('http://localhost/', {
      headers: { 'Cf-Access-Jwt-Assertion': makeJwt({ sub: 'user-1', email: 'user@example.com' }) },
    });

    const identity = (await provider.resolve(request))._unsafeUnwrap();

    expect(identity).toEqual({ kind: 'user', id: 'user-1', email: 'user@example.com', displayName: 'user@example.com', groups: [] });
  });

  it('get-identity の失敗はキャッシュされない — 直後の成功リクエストで本物の detail が取れる', async () => {
    const request = new Request('http://localhost/', {
      headers: { 'Cf-Access-Jwt-Assertion': makeJwt({ sub: 'user-2', email: 'user2@example.com', identity_nonce: 'nonce-1' }) },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const failed = (await cloudflareAccessIdentity(env).resolve(request))._unsafeUnwrap();

    expect(failed).toEqual({ kind: 'user', id: 'user-2', email: 'user2@example.com', displayName: 'user2@example.com', groups: [] });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'Real Name', groups: [{ name: 'admins' }] }), { status: 200 })),
    );
    const recovered = (await cloudflareAccessIdentity(env).resolve(request))._unsafeUnwrap();

    expect(recovered).toEqual({ kind: 'user', id: 'user-2', email: 'user2@example.com', displayName: 'Real Name', groups: ['admins'] });
  });
});
