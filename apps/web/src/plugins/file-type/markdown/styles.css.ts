import { css } from '@styled/css';

// 要素ごとのスタイル(見出し・リンク・table・blockquote・code)は
// react-markdown の components 対応表(./components/index.tsx)側に移した。
// ここはレイアウトだけを持つ。
export const markdownRoot = css({
  p: 'block',
  maxW: '[calc(var(--sizes-grid-cell) * 30)]',
  mx: 'auto',
  color: 'fg.default',
  lineHeight: 'jp',
  display: 'grid',
  gap: 'element',
});
