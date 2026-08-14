import { UnauthenticatedError } from '@r2-drive/core';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import type { Identity, IdentityProviderFactory } from './types';

type AccessPayload = { readonly sub?: string; readonly email?: string; readonly common_name?: string; readonly identity_nonce?: string };

type GetIdentityResponse = { readonly name?: string; readonly email?: string; readonly groups?: readonly { readonly name: string }[] };

// identity_nonce をキーに get-identity の結果を寝かせる。このクレームはまさにその用途で存在する。
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

export const cloudflareAccessIdentity: IdentityProviderFactory = (env) => ({
  id: 'cloudflare-access',
  resolve: (request) => {
    // 署名検証は前段の @hono/cloudflare-access が済ませている。ここは正規化だけ。
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (jwt === null) return errAsync(new UnauthenticatedError('missing Cf-Access-Jwt-Assertion'));
    const payload = decodePayload(jwt);
    if (payload === undefined) return errAsync(new UnauthenticatedError('malformed assertion'));

    if (payload.common_name !== undefined) {
      return okAsync({ kind: 'service', id: payload.common_name, commonName: payload.common_name });
    }

    const { sub, email, identity_nonce: nonce } = payload;
    if (sub === undefined || email === undefined) return errAsync(new UnauthenticatedError('assertion lacks sub/email'));

    const cached = nonce === undefined ? undefined : identityCache.get(nonce);
    if (cached !== undefined) return okAsync(cached);

    return fromPromise(
      fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/get-identity`, {
        headers: { cookie: request.headers.get('cookie') ?? '' },
      }).then((res) => (res.ok ? res.json<GetIdentityResponse>() : ({} as GetIdentityResponse))),
      (cause) => new UnauthenticatedError('get-identity failed', { cause }),
    )
      .orElse(() => okAsync({} as GetIdentityResponse))
      .map((detail): Identity => {
        // displayName は常に存在する。無ければプロバイダが email に落とす責務を持つ。
        const identity = {
          kind: 'user',
          id: sub,
          email,
          displayName: detail.name ?? email,
          groups: (detail.groups ?? []).map((g) => g.name),
        } satisfies Identity;
        if (nonce !== undefined) identityCache.set(nonce, identity);

        return identity;
      });
  },
});
