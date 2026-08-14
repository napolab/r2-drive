import { css } from '@styled/css';

// fill / stroke / strokeWidth は Panda の css() に乗せない。preset-base では
// fill/stroke は colors トークンカテゴリ、strokeWidth は borderWidths トークン
// カテゴリにマップされる(strictTokens: true)。'currentColor' や '1.5' はどちらの
// カテゴリにも無い値でビルドが落ちる(詳細は report 参照)。グリフの線色・線幅は
// テーマの色/枠線トークンではなくアイコン自体の描画情報なので、index.tsx 側で
// SVG のプレゼンテーション属性として直接指定する。ここはレイアウト上の懸念
// (flexShrink)だけを扱う。
export const icon = css({ flexShrink: 0 });
