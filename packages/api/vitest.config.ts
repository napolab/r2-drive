import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './test/worker-entry.ts',
      miniflare: {
        r2Buckets: ['BUCKET_PHOTOS', 'BUCKET_MEDIA'],
        durableObjects: { OBJECT_INDEX: { className: 'ObjectIndex', useSQLite: true } },
        bindings: { ACCESS_TEAM: 'test', ACCESS_AUD: 'test', IDENTITY_PROVIDER: 'static' },
      },
    }),
  ],
  test: {
    name: 'api',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
