import { cloudflareAccessIdentity } from './cloudflare-access';
import { staticIdentity } from './static';

import type { IdentityProvider } from './types';

// createRunner を使わない。first-match で static にフォールバックすると、
// 本番で Access 検証が落ちたとき開発用 Identity が通ってしまう。
export const createIdentityProvider = (env: Env): IdentityProvider => (env.IDENTITY_PROVIDER === 'static' ? staticIdentity(env) : cloudflareAccessIdentity(env));
