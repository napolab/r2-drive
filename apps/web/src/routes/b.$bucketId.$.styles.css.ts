import { css } from '@styled/css';

// Virtualizer は親の高さから可視領域を決める。ここで縦を確定させないと
// 一覧が内容の高さまで伸びて仮想化が効かない。'100dvh' / '100%' は sizes トークンの
// 対象外の充填値なので strictTokens のエスケープハッチで書く。
export const pageRoot = css({
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
  gap: 'element',
  height: '[100dvh]',
  p: 'page',
  bg: 'bg.canvas',
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
