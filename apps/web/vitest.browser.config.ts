import { playwright } from '@vitest/browser-playwright';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  resolve: { tsconfigPaths: true },
  plugins: [viteReact()],
  test: {
    name: 'web-browser',
    include: ['src/**/*.browser.test.tsx'],
    setupFiles: ['./vitest.browser.setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 800, height: 700 },
    },
  },
});
