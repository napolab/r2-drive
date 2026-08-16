import { css } from '@styled/css';

// Virtualizer が可視領域を測るためのスクロールコンテナ。'100%' は sizes トークンの
// 対象外の値なので strictTokens のエスケープハッチで書く(panda.config.ts の
// outlineOffset: '[3px]' と同じ扱い)。レイアウトの充填であって寸法の設計値ではない。
// バブルしてきた focus を受けるためだけのラッパ。レイアウトボックスを作らないので
// Virtualizer の可視領域の測定に影響しない。
export const focusScope = css({ display: 'contents' });

export const listRoot = css({
  height: '[100%]',
  overflow: 'auto',
  // 一覧そのものの輪郭。中身(行)が一覧の存在を示すので、この線は装飾。
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
  bg: 'bg.canvas',
  '&[data-drop-target]': { borderColor: 'accent.solid', bg: 'bg.subtle' },
});

// 状態は data 属性で公開し、CSS セレクタで当てる。条件付き className は書かない。
// react-aria が data-hovered / data-selected / data-focus-visible を自動で付ける。
export const tile = css({
  display: 'grid',
  // preview の残り 1fr は、168px 幅から padding を引いた content 幅と一致する。
  // その下を 48px(名前 2 行) + 24px(meta) に固定し、全 tile の高さを揃える。
  gridTemplateRows: '[minmax(0, 1fr) var(--sizes-file-name-area) var(--sizes-target-min)]',
  boxSizing: 'border-box',
  w: 'fileTileWidth',
  h: 'fileTileHeight',
  p: 'element',
  fontSize: 'sm',
  fontWeight: 'normal',
  lineHeight: 'snug',
  cursor: 'default',
  overflow: 'hidden',
  borderRadius: 'none',
  // tile の種別も状態と同じく data 属性で公開し、CSS 側で当てる。
  // 潜れる tile(フォルダ)を字面で見分けられるようにする。
  '&[data-kind="folder"]': { fontWeight: 'medium' },
  // 選択可能な tile は、この境界線が形を伝えるので 3:1 を強制した token を使う。
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  bg: 'bg.canvas',
  '&[data-hovered]': { bg: 'bg.subtle' },
  '&[data-selected]': { bg: 'bg.emphasis', borderColor: 'accent.solid' },
  // 自前で outline を書かない。panda.config.ts の layerStyles.focusRing を使う。
  // ただし offset だけは内側に倒す: focusRing の既定 +3px は tile の外に出るため、
  // overflow: auto のスクロールコンテナに切られて「tile の下に破線が 1 本走る」ように
  // 見える(開発サーバーで確認)。色・線種・太さは layerStyle のまま。
  '&[data-focus-visible]': { layerStyle: 'focusRing', outlineOffset: '[-3px]' },
});

// GridListItem が定義した 3 行を子へそのまま渡す。preview / name / meta が
// 内容量に左右されず完全に同じ track を使うための user-required subgrid。
export const tileGrid = css({
  display: 'grid',
  gridColumn: '[1]',
  gridRow: '[1 / -1]',
  gridTemplateRows: 'subgrid',
  minW: '[0]',
  minH: '[0]',
});

// 次ページ取得のセンチネル。行ではないので罫線を持たせない。
export const loadMore = css({
  display: 'grid',
  alignItems: 'center',
  px: 'element',
  color: 'fg.subtle',
  fontFamily: 'mono',
  fontSize: 'xs',
});

export const previewRoot = css({
  display: 'grid',
  placeItems: 'center',
  minW: '[0]',
  minH: '[0]',
  aspectRatio: '1',
  overflow: 'hidden',
  bg: 'bg.muted',
  color: 'fg.muted',
  borderBottomWidth: 'hairline',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.subtle',
});

export const nameRoot = css({
  display: 'grid',
  alignItems: 'center',
  minW: '[0]',
  px: 'inline',
  borderBottomWidth: 'hairline',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.subtle',
});

export const name = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  lineClamp: 2,
  color: 'fg.default',
});

// 「全部に、名前がついてしまう」— サイズと file type はシステム注釈そのもの。
// 等幅 + tabular-nums で tile が変わっても桁が揃う。
export const metaRoot = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'inline',
  minW: '[0]',
  px: 'inline',
  overflow: 'hidden',
  color: 'fg.muted',
  fontFamily: 'mono',
  fontSize: '2xs',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});
