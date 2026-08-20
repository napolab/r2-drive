import { css } from '@styled/css';

// tokens.fontSizes に 2xl / fontWeights に bold は無い(strictTokens、preset-base のみ)。
// fontSizes.h1/h2/h3 はこの用途向けに用意された見出し専用トークンなのでそれを使う。
// fontWeights は normal/medium/semibold の 3 段しか無いため bold の代わりに semibold を使う。
export const h1 = css({ fontSize: 'h1', fontWeight: 'semibold', lineHeight: 'snug' });
export const h2 = css({ fontSize: 'h2', fontWeight: 'semibold', lineHeight: 'snug' });
// h4-h6 用の専用トークンは無いため、h3 と同じ見た目を割り当てる(タグはそれぞれの階層のまま)。
export const h3 = css({ fontSize: 'h3', fontWeight: 'semibold', lineHeight: 'snug' });

export const paragraph = css({ lineHeight: 'jp' });

export const link = css({ color: 'accent.text', textDecoration: 'underline' });

export const list = css({ pl: 'block' });

export const table = css({ borderCollapse: 'collapse' });

export const tableCell = css({
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.default',
  px: 'element',
  py: 'inline',
});

export const blockquote = css({
  borderLeftWidth: 'strong',
  borderLeftStyle: 'solid',
  borderLeftColor: 'border.strong',
  pl: 'element',
  color: 'fg.muted',
});

export const inlineCode = css({
  fontFamily: 'mono',
  fontSize: 'sm',
  bg: 'code.bg',
  color: 'code.fg',
  px: 'inline',
});
