import { okAsync } from 'neverthrow';

import type { IdentityProviderFactory } from './types';

// wrangler dev には Access が居ない。これが無いとローカル開発ができない。
export const staticIdentity: IdentityProviderFactory = () => ({
  id: 'static',
  resolve: () => okAsync({ kind: 'user', id: 'local', email: 'local@example.com', displayName: 'local', groups: [] }),
});
