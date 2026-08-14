import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // tsconfig.base.json の paths(@styled/* など)を vite にも効かせる。
  resolve: { tsconfigPaths: true },
  plugins: [
    // wrangler.jsonc の main(src/worker.ts)を ssr 環境のエントリとして扱わせる。
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    // routes/ に置く <route>.styles.css.ts をルートとして拾わせない。
    tanstackStart({ router: { routeFileIgnorePattern: '\\.styles\\.css\\.ts$' } }),
    // react の vite plugin は start の vite plugin より後に置く。
    viteReact(),
  ],
});
