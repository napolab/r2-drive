import { css } from '@styled/css';

// fill/stroke は colors トークンカテゴリにマップされ(strictTokens: true)、
// 'none'/'currentColor' に等価物が無いため css() を経由できない
// (design-direction.md「SVG のペイント系プロパティの例外」参照)。index.tsx 側で
// SVG のプレゼンテーション属性として直接指定する。
// strokeWidth は borderWidths トークンに等価物がある(hairline/default/strong)
// ので、例外の対象外として css() に留める。
export const icon = css({ flexShrink: 0, strokeWidth: 'default' });
