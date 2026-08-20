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

export const headerActionsRoot = css({
  display: 'flex',
  alignItems: 'center',
  gap: 'element',
});

// トグルの選択状態はコンポーネントの存在(押されている方)を示すだけの色替えなので
// 境界そのものは border.interactive(design-direction「境界線には 2 種類ある」)。
export const viewModeToggleRoot = css({
  display: 'flex',
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  borderRadius: 'none',
});

export const viewModeToggleButton = css({
  display: 'inline-flex',
  alignItems: 'center',
  minH: 'targetComfortable',
  px: 'element',
  color: 'fg.default',
  bg: 'bg.canvas',
  fontFamily: 'mono',
  fontSize: 'xs',
  fontWeight: 'medium',
  cursor: 'pointer',
  '&:nth-child(1)': { borderRightWidth: 'hairline', borderRightStyle: 'solid', borderRightColor: 'border.interactive' },
  '&[data-hovered]:not([data-selected])': { bg: 'bg.subtle' },
  '&[data-selected]': { bg: 'accent.solid', color: 'fg.onSolid' },
  '&[data-focus-visible]': { layerStyle: 'focusRing' },
});

// GalleryView の直下ラッパ。Delete/Backspace の keydown capture だけを足すための
// もので、display: contents で自身はレイアウトボックスを作らない — object-list の
// focusScope と同じ理由(親 grid の直接の子は GalleryView 自身の root であるべき)。
export const gallerySelectionScope = css({ display: 'contents' });

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
