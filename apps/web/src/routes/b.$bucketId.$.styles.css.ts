import { css } from '@styled/css';

// Virtualizer は親の高さから可視領域を決める。ここで縦を確定させないと
// 一覧が内容の高さまで伸びて仮想化が効かない。'100dvh' / '100%' は sizes トークンの
// 対象外の充填値なので strictTokens のエスケープハッチで書く。
export const pageRoot = css({
  display: 'grid',
  gridTemplateRows: 'minmax(0, 1fr)',
  height: '[100dvh]',
  p: 'page',
  bg: 'bg.canvas',
});

export const headerRoot = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'element',
  minW: '[0]',
});

export const headingRoot = css({
  display: 'grid',
  gap: 'inline',
  minW: '[0]',
});

// バケット / プレフィックスはパスそのもの。システム注釈なので等幅で組む。
export const heading = css({
  fontFamily: 'mono',
  fontSize: 'sm',
  fontWeight: 'medium',
  color: 'fg.muted',
  letterSpacing: 'wide',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const uploadError = css({
  color: 'danger.text',
  fontSize: 'sm',
});

export const actionNotice = css({
  color: 'fg.muted',
  fontSize: 'sm',
  '&[data-kind="error"]': { color: 'danger.text' },
  '&[data-kind="success"]': { color: 'accent.text' },
});
