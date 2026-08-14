import { defineGlobalStyles } from '@pandacss/dev';

// Kept minimal on purpose (see .claude/rules/design-direction.md). Panda's
// `preflight: true` already handles box-sizing / margin resets, so this file
// only carries what preflight cannot: the token-driven document defaults, the
// Japanese line-height override, and clearing the browser's default focus
// ring so `layerStyles.focusRing` (panda.config.ts) can replace it per
// component.
export const globalCss = defineGlobalStyles({
  html: {
    fontFamily: 'body',
    color: 'fg.default',
    background: 'bg.canvas',
    lineHeight: 'jp',
  },
  '*:focus-visible': {
    outline: 'none',
  },
});
