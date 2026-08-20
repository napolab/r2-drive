import { css } from '@styled/css';

// shiki の raw theme(apps/web/src/highlight/index.ts)が参照する --code-* 変数へ
// colors.code.* token を 1:1 で配る。theme の background は transparent なので、
// この要素の bg(code.bg)がそのままパネルの地色になる。
const codeVariables = {
  '--code-fg': 'token(colors.code.fg)',
  '--code-comment': 'token(colors.code.comment)',
  '--code-keyword': 'token(colors.code.keyword)',
  '--code-string': 'token(colors.code.string)',
  '--code-number': 'token(colors.code.number)',
  '--code-function': 'token(colors.code.function)',
  '--code-punctuation': 'token(colors.code.punctuation)',
} as const;

// hast-util-to-jsx-runtime の components.pre が shiki の <pre> を置き換える先。
export const codeBlock = css({
  ...codeVariables,
  minW: '[0]',
  p: 'element',
  bg: 'code.bg',
  color: 'code.fg',
  fontFamily: 'mono',
  fontSize: 'sm',
  lineHeight: 'snug',
  overflowX: 'auto',
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
