import { defineConfig } from 'vitest/config';

// vitest.config.ts があると vite.config.ts は読まれない。@styled/* と @r2-drive/* の解決は
// vite の resolve.tsconfigPaths(既定 false)に依存しているので、ここにも明示する。
// これが無いと Task 12 以降の UI テストが `Failed to resolve import "@styled/css"` で落ちる。
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: 'web',
    environment: 'jsdom',
    // jsdom に足りないブラウザ API を足す(理由は vitest.setup.ts のコメント)。
    setupFiles: ['./vitest.setup.ts'],
  },
});
