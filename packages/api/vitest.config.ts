import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './test/worker-entry.ts',
      miniflare: {
        // wrangler.jsonc の compatibility_date と揃えて固定する。未指定だと
        // vitest-pool-workers が「今日」を使うため、インストール済み workerd の
        // 対応上限を日付が越えた朝に全テストが起動しなくなる(2026-08-19 に実際に発生)。
        compatibilityDate: '2026-08-01',
        r2Buckets: ['BUCKET_PHOTOS', 'BUCKET_MEDIA'],
        // 本番の class_name は 'ObjectIndex'(apps/web/wrangler.jsonc)。テストでは
        // 覗き見用のメソッドを足したサブクラスを実体化する(test/worker-entry.ts)。
        durableObjects: { OBJECT_INDEX: { className: 'ObjectIndexUnderTest', useSQLite: true } },
        bindings: { ACCESS_TEAM: 'test', ACCESS_AUD: 'test', IDENTITY_PROVIDER: 'static' },
      },
    }),
  ],
  test: {
    name: 'api',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
