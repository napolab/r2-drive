import { css } from '@styled/css';

// createCssVariablesTheme(prefix: --shiki-)が参照する変数へ code.* token を配る。
// constant→number, parameter→fg, string-expression→string, link→function に寄せる
// (code.* は 7 色。shiki 側の変数のほうが多いので近い役割へ束ねる)。
const shikiVariables = {
  '--shiki-foreground': 'token(colors.code.fg)',
  '--shiki-background': 'token(colors.code.bg)',
  '--shiki-token-constant': 'token(colors.code.number)',
  '--shiki-token-string': 'token(colors.code.string)',
  '--shiki-token-comment': 'token(colors.code.comment)',
  '--shiki-token-keyword': 'token(colors.code.keyword)',
  '--shiki-token-parameter': 'token(colors.code.fg)',
  '--shiki-token-function': 'token(colors.code.function)',
  '--shiki-token-string-expression': 'token(colors.code.string)',
  '--shiki-token-punctuation': 'token(colors.code.punctuation)',
  '--shiki-token-link': 'token(colors.code.function)',
} as const;

export const root = css({
  ...shikiVariables,
  minW: '[0]',
  '& pre': {
    p: 'element',
    bg: 'code.bg',
    fontFamily: 'mono',
    fontSize: 'sm',
    lineHeight: 'snug',
    overflowX: 'auto',
  },
});

export const plainPre = css({
  p: 'element',
  bg: 'code.bg',
  color: 'code.fg',
  fontFamily: 'mono',
  fontSize: 'sm',
  lineHeight: 'snug',
  overflowX: 'auto',
});
