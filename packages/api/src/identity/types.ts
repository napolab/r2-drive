import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

// Access のサービストークンは email も sub も持たず common_name になる。
// 最初から 2 系統を吸収する union にする。
export type Identity =
  | { readonly kind: 'user'; readonly id: string; readonly email: string; readonly displayName: string; readonly groups: readonly string[] }
  | { readonly kind: 'service'; readonly id: string; readonly commonName: string };

export type IdentityProvider = {
  readonly id: string;
  resolve(request: Request): ResultAsync<Identity, DriveError>;
};

export type IdentityProviderFactory = (env: Env) => IdentityProvider;
