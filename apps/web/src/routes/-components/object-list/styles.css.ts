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
});

// 状態は data 属性で公開し、CSS セレクタで当てる。条件付き className は書かない。
// react-aria が data-hovered / data-selected / data-focus-visible を自動で付ける。
export const row = css({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto auto',
  alignItems: 'center',
  columnGap: 'element',
  // ListLayout の rowSize と同じ値。index.tsx が token('sizes.targetComfortable') から引く。
  h: 'targetComfortable',
  px: 'element',
  fontSize: 'sm',
  fontWeight: 'normal',
  lineHeight: 'snug',
  cursor: 'default',
  // 行の種別も状態と同じく data 属性で公開し、CSS 側で当てる。
  // 潜れる行(フォルダ)を字面で見分けられるようにする。
  '&[data-kind="folder"]': { fontWeight: 'medium' },
  // 行と行の仕切り。行は文字と背景で存在が分かるので、この線は装飾(WCAG 1.4.11 の対象外)。
  borderBottomWidth: 'hairline',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.subtle',
  // 左辺の帯。「選択されている」ことをこの線だけが示すので機能側の色を使う。
  // 既定は装飾色、選択時だけ accent.solid(bg.canvas に対して 3:1 以上を tokens.test.ts が強制)。
  borderLeftWidth: 'default',
  borderLeftStyle: 'solid',
  borderLeftColor: 'border.subtle',
  '&[data-hovered]': { bg: 'bg.subtle' },
  '&[data-selected]': { bg: 'bg.emphasis', borderLeftColor: 'accent.solid' },
  // 自前で outline を書かない。panda.config.ts の layerStyles.focusRing を使う。
  // ただし offset だけは内側に倒す: focusRing の既定 +3px は行の外に出るため、
  // overflow: auto のスクロールコンテナに切られて「行の下に破線が 1 本走る」ように
  // 見える(開発サーバーで確認)。色・線種・太さは layerStyle のまま。
  '&[data-focus-visible]': { layerStyle: 'focusRing', outlineOffset: '[-3px]' },
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

export const icon = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  w: 'targetMin',
  color: 'fg.muted',
  fontFamily: 'mono',
});

export const name = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'fg.default',
});

// 「全部に、名前がついてしまう」— サイズと更新日時はシステム注釈そのもの。
// 等幅 + tabular-nums で行が変わっても桁が揃う。
export const meta = css({
  color: 'fg.muted',
  fontFamily: 'mono',
  fontSize: 'xs',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});
