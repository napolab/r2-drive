import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  preflight: true,
  include: ['./src/**/*.{js,jsx,ts,tsx}'],
  exclude: [],
  // tsconfig.base.json の "@styled/*" エイリアス経由の import を静的抽出できるようにする。
  // これが無いと utilities レイヤーが空のまま出力される。
  importMap: '@styled',
  theme: {
    extend: {},
  },
  outdir: 'styled-system',
});
