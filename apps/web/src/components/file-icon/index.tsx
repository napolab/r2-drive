import * as s from './styles.css';

type Glyph = 'doc' | 'image' | 'video' | 'audio' | 'blank';

type Props = { readonly size: number; readonly glyph: Glyph };

const PATHS = {
  doc: 'M6 2h8l4 4v16H6z',
  image: 'M4 5h16v14H4zm2 10l4-4 3 3 3-3 4 4',
  video: 'M4 5h16v14H4zm6 3l6 4-6 4z',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  blank: 'M6 2h12v20H6z',
} satisfies Record<Glyph, string>;

export const FileIcon = ({ size, glyph }: Props) => (
  // fill/stroke/strokeWidth は Panda の css() を通さず SVG のプレゼンテーション
  // 属性として直接指定する(理由は styles.css.ts のコメント参照)。
  <svg className={s.icon} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" data-glyph={glyph}>
    <path d={PATHS[glyph]} />
  </svg>
);
