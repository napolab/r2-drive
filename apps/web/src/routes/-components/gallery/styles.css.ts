import { css } from '@styled/css';

export const root = css({
  display: 'flex',
  flexDirection: 'column',
  h: '[100%]',
});

// チップ列そのものは選択も仮想化もしない普通の flex wrap 列。フォルダとファイルの
// 名前(識別子)が主役なので mono フォントで組む(design-direction「全部に、名前が
// ついてしまう」)。
export const chipListRoot = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'inline',
  p: 'block',
  borderBottomWidth: 'hairline',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.subtle',
});

// チップはタグ的な UI 要素なので pill を選ぶ(design-direction: 角丸は既定 none、
// 丸めたいときは意図を持って pill を選ぶ)。native <button> が既に interactive
// semantics を持つので、輪郭は装飾用途の border.subtle で足りる。
export const chip = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inline',
  minH: 'targetMin',
  maxW: '[240px]',
  px: 'element',
  borderRadius: 'pill',
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
  bg: 'bg.subtle',
  color: 'fg.default',
  fontFamily: 'mono',
  fontSize: 'sm',
  cursor: 'default',
  '&[data-hovered]': { bg: 'bg.emphasis' },
  '&[data-pressed]': { bg: 'bg.emphasis' },
  '&[data-disabled]': { opacity: 'disabled', cursor: 'not-allowed' },
  '&[data-focus-visible]': { layerStyle: 'focusRing' },
});

export const chipMore = css({
  display: 'inline-flex',
  alignItems: 'center',
  minH: 'targetMin',
  px: 'element',
  borderRadius: 'pill',
  borderWidth: 'hairline',
  borderStyle: 'dashed',
  borderColor: 'border.default',
  color: 'fg.muted',
  fontFamily: 'mono',
  fontSize: 'sm',
  cursor: 'default',
  '&[data-hovered]': { bg: 'bg.subtle' },
  '&[data-pressed]': { bg: 'bg.subtle' },
  '&[data-focus-visible]': { layerStyle: 'focusRing' },
});

export const chipLabel = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
