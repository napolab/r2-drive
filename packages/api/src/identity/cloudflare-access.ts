import { UnauthenticatedError } from '@r2-drive/core';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import type { Identity, IdentityProviderFactory } from './types';

type AccessPayload = { readonly sub?: string; readonly email?: string; readonly common_name?: string; readonly identity_nonce?: string };

type GetIdentityResponse = { readonly name?: string; readonly email?: string; readonly groups?: readonly { readonly name: string }[] };

// identity_nonce をキーに get-identity の結果を寝かせる。このクレームはまさにその用途で存在する。
// キーは `${sub}:${nonce}`。isolate 内でのユーザー間分離を、nonce がユーザーごとに大域一意である
// という Cloudflare 側の保証だけに委ねない — このコード自身が sub で分離する。
const identityCache = new Map<string, Identity>();

const decodePayload = (jwt: string): AccessPayload | undefined => {
  const [, payload] = jwt.split('.');
  if (payload === undefined) return undefined;
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return undefined;
  }
};

// このプロバイダは、同じチェーン内でより早く Access の署名検証が走っていない限りマウントしてはならない。
// ここは検証済みペイロードの正規化のみを行う(署名検証はしない)。
export const cloudflareAccessIdentity: IdentityProviderFactory = (env) => ({
  id: 'cloudflare-access',
  resolve: (request) => {
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (jwt === null) return errAsync(new UnauthenticatedError('missing Cf-Access-Jwt-Assertion'));
    const payload = decodePayload(jwt);
    if (payload === undefined) return errAsync(new UnauthenticatedError('malformed assertion'));

    if (payload.common_name !== undefined) {
      return okAsync({ kind: 'service', id: payload.common_name, commonName: payload.common_name });
    }

    const { sub, email, identity_nonce: nonce } = payload;
    if (sub === undefined || email === undefined) return errAsync(new UnauthenticatedError('assertion lacks sub/email'));

    const cacheKey = nonce === undefined ? undefined : `${sub}:${nonce}`;
    const cached = cacheKey === undefined ? undefined : identityCache.get(cacheKey);
    if (cached !== undefined) return okAsync(cached);

    // displayName は常に存在する。無ければプロバイダが email に落とす責務を持つ。
    // groups は get-identity が失敗すると [] に潰れる — 認可の入力にするなら types.ts のコメント参照。
    const buildIdentity = (detail: GetIdentityResponse): Identity =>
      ({
        kind: 'user',
        id: sub,
        email,
        displayName: detail.name ?? email,
        groups: (detail.groups ?? []).map((g) => g.name),
      }) satisfies Identity;

    return fromPromise(
      fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/get-identity`, {
        headers: { cookie: request.headers.get('cookie') ?? '' },
      }).then((res) => {
        if (!res.ok) throw new Error(`get-identity responded with status ${res.status}`);

        return res.json<GetIdentityResponse>();
      }),
      (cause) => new UnauthenticatedError('get-identity failed', { cause }),
    )
      .map((detail) => {
        // 本物の detail が取れたときだけキャッシュする。ネットワーク障害 / 非 2xx / 不正 JSON はここを通らない
        // ので、一時的な障害でユーザーが isolate の生存期間中ずっと email フォールバックに固定されることはない。
        const identity = buildIdentity(detail);
        if (cacheKey !== undefined) identityCache.set(cacheKey, identity);

        return identity;
      })
      .orElse(() => okAsync(buildIdentity({})));
  },
});
