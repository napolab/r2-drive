import { defineConfig } from '@pandacss/dev';

import { breakpoints } from './src/themes/breakpoints';
import { globalCss } from './src/themes/global-css';
import { semanticTokens, tokens } from './src/themes/tokens';

export default defineConfig({
  strictTokens: true,
  jsxFramework: 'react',
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  exclude: [],
  outdir: 'styled-system',
  // デフォルトプリセット(`@pandacss/preset-panda`)は utilities に加えて汎用の
  // token セット(fontSizes.2xl / fontWeights.bold 等)まで持ち込み、strictTokens
  // 下でもすり抜けてしまう(Ruling 19)。utilities/conditions だけを提供する
  // `@pandacss/preset-base` に絞り、token は tokens/index.ts のみを正とする。
  presets: ['@pandacss/preset-base'],
  // tsconfig.base.json の "@styled/*" エイリアス経由の import を静的抽出できるようにする。
  // これが無いと utilities レイヤーが空のまま出力される(Task 2 の report参照)。
  importMap: '@styled',
  globalCss,
  theme: {
    breakpoints,
    extend: {
      tokens,
      semanticTokens,
      layerStyles: {
        focusRing: {
          value: {
            // base = 静的な破線(reduced-motion のフォールバック)
            outlineWidth: 'default',
            outlineStyle: 'dashed',
            outlineColor: 'accent.solid',
            outlineOffset: '[3px]',
            borderRadius: 'none',
          },
        },
      },
      keyframes: {
        marchingAnts: {
          to: { backgroundPosition: '8px 0, -8px 100%, 0 -8px, 100% 8px' },
        },
      },
    },
  },
});
