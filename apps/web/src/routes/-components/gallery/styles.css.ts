import { css } from '@styled/css';

export const root = css({
  display: 'flex',
  flexDirection: 'column',
  h: '[100%]',
});

// 画像 skyline 本体のスクロールコンテナ。object-list の listRoot と同じ役割。
export const gridRoot = css({
  flex: '[1]',
  overflow: 'auto',
  bg: 'bg.canvas',
  '&[data-drop-target]': { borderColor: 'accent.solid', bg: 'bg.subtle' },
});

// skyline は行の高さを ratio で決めるので、tile と違い固定の grid-template は持たない。
// セルの境界は選択可能な tile と同じく 3:1 を強制する border.interactive を使う。
export const cell = css({
  display: 'block',
  boxSizing: 'border-box',
  w: '[100%]',
  h: '[100%]',
  overflow: 'hidden',
  cursor: 'default',
  bg: 'bg.muted',
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  '&[data-hovered]': { bg: 'bg.subtle' },
  '&[data-selected]': { borderColor: 'accent.solid' },
  '&[data-focus-visible]': { layerStyle: 'focusRing', outlineOffset: '[-3px]' },
});

// 画像 <img> / 動画 <video> の両方に使う。動画は先頭フレームがサムネイルになる。
export const cellImage = css({
  display: 'block',
  w: '[100%]',
  h: '[100%]',
  objectFit: 'cover',
});

export const cellFallback = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'inline',
  w: '[100%]',
  h: '[100%]',
  p: 'element',
  color: 'fg.muted',
});

export const cellFallbackName = css({
  maxW: '[100%]',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'fg.subtle',
  fontFamily: 'mono',
  fontSize: '2xs',
});

// 次ページ取得のセンチネル。object-list と同じ役割。
export const loadMore = css({
  display: 'grid',
  alignItems: 'center',
  px: 'element',
  color: 'fg.subtle',
  fontFamily: 'mono',
  fontSize: 'xs',
});
