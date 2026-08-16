import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createIdentityProvider } from './factory';

describe('createIdentityProvider', () => {
  it('IDENTITY_PROVIDER=static のとき static を返す', () => {
    expect(createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'static' }).id).toBe('static');
  });

  it('IDENTITY_PROVIDER=access のとき cloudflare-access を返す', () => {
    expect(createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'access' }).id).toBe('cloudflare-access');
  });

  it('static provider は固定の user Identity を返す', async () => {
    const provider = createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'static' });
    const identity = (await provider.resolve(new Request('http://localhost/')))._unsafeUnwrap();

    expect(identity.kind).toBe('user');
    expect(identity).toHaveProperty('displayName');
  });

  it('access provider は assertion が無ければ UnauthenticatedError', async () => {
    const provider = createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'access' });
    const result = await provider.resolve(new Request('http://localhost/'));

    expect(result._unsafeUnwrapErr().name).toBe('UnauthenticatedError');
  });
});
