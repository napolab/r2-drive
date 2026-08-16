import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

// Access のサービストークンは email も sub も持たず common_name になる。
// 最初から 2 系統を吸収する union にする。
export type Identity =
  | {
      readonly kind: 'user';
      readonly id: string;
      readonly email: string;
      readonly displayName: string;
      // groups を認可の入力に使うなら、その前に get-identity の失敗をハードエラーにすること。
      // 現状は cloudflare-access.ts で失敗が空配列に潰れるため、認可に使うと fail-open になる。
      readonly groups: readonly string[];
    }
  | { readonly kind: 'service'; readonly id: string; readonly commonName: string };

export type IdentityProvider = {
  readonly id: string;
  resolve(request: Request): ResultAsync<Identity, DriveError>;
};

export type IdentityProviderFactory = (env: Env) => IdentityProvider;
