/// <reference types="vite/client" />
import mplus1Latin400 from '@fontsource/m-plus-1/files/m-plus-1-latin-400-normal.woff2';
import mplus1Latin500 from '@fontsource/m-plus-1/files/m-plus-1-latin-500-normal.woff2';
import mplus1Latin700 from '@fontsource/m-plus-1/files/m-plus-1-latin-700-normal.woff2';

// Self-hosted M PLUS 1, Latin subset only (no `next/font` here — this repo has
// no Next.js, so font URLs are resolved via Vite's asset pipeline instead).
//
// Two distinct font-family names stand in for next/font's two hashed
// per-instantiation families:
//
// - `mplus1`    — weight 400/500, used for regular body copy.
// - `mplus1-en` — weight 700 only, prepended ahead of `mplus1` in the fallback
//                 stack (see tokens/index.ts `fonts.body` / `fonts.display`).
//
// Neither family ships Japanese glyphs (only the Latin subset is imported
// above), so Japanese text always falls through past both custom families to
// the system sans at the end of the stack. A shared `font-weight` can
// therefore never thicken the Japanese system font: only Latin glyphs are
// ever resolved through these two faces, and JP always renders at its native
// system weight.
//
// This CSS is generated here (rather than routed through panda.config.ts's
// `globalFontface`) because Panda's config loader bundles panda.config.ts
// with its own esbuild pass, which has no loader for `.woff2` — only Vite's
// app bundle (which processes this file when `__root.tsx` imports it) can
// resolve these imports to real, hashed asset URLs.
const MPLUS1_FAMILY = 'mplus1';
const MPLUS1_EN_FAMILY = 'mplus1-en';

const fontFace = (family: string, weight: string, url: string): string =>
  `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('${url}') format('woff2'); }`;

/**
 * Raw @font-face + `:root` custom-property CSS. Injected via a `<style>` tag
 * in `__root.tsx`'s `<head>` so `--font-mplus1` / `--font-mplus1-en` are
 * available on the root element for `tokens.fonts.body` / `.display` to
 * reference via `var(...)`.
 */
export const fontFaceCss = [
  fontFace(MPLUS1_FAMILY, '400', mplus1Latin400),
  fontFace(MPLUS1_FAMILY, '500', mplus1Latin500),
  fontFace(MPLUS1_EN_FAMILY, '700', mplus1Latin700),
  `:root { --font-mplus1: '${MPLUS1_FAMILY}'; --font-mplus1-en: '${MPLUS1_EN_FAMILY}'; }`,
].join('\n');
