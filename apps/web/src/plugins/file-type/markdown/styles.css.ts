import { css } from '@styled/css';

export const markdownRoot = css({
  p: 'block',
  maxW: '[calc(var(--sizes-grid-cell) * 30)]',
  mx: 'auto',
  color: 'fg.default',
  lineHeight: 'jp',
  display: 'grid',
  gap: 'element',
  // tokens.fontSizes に 2xl / fontWeights に bold は無い(strictTokens、preset-base のみ)。
  // fontSizes.h1/h2/h3 はこの用途向けに用意された見出し専用トークンなのでそれを使う。
  // fontWeights は normal/medium/semibold の 3 段しか無いため bold の代わりに semibold を使う。
  '& h1': { fontSize: 'h1', fontWeight: 'semibold', lineHeight: 'snug' },
  '& h2': { fontSize: 'h2', fontWeight: 'semibold', lineHeight: 'snug' },
  '& h3': { fontSize: 'h3', fontWeight: 'semibold', lineHeight: 'snug' },
  '& ul, & ol': { pl: 'block' },
  '& a': { color: 'accent.text', textDecoration: 'underline' },
  '& table': { borderCollapse: 'collapse' },
  '& th, & td': {
    borderWidth: 'hairline',
    borderStyle: 'solid',
    borderColor: 'border.default',
    px: 'element',
    py: 'inline',
  },
  '& blockquote': {
    borderLeftWidth: 'strong',
    borderLeftStyle: 'solid',
    borderLeftColor: 'border.strong',
    pl: 'element',
    color: 'fg.muted',
  },
});

export const inlineCode = css({
  fontFamily: 'mono',
  fontSize: 'sm',
  bg: 'code.bg',
  color: 'code.fg',
  px: 'inline',
});
