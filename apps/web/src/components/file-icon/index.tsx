import { token } from '@styled/tokens';

import * as s from './styles.css';

export type FileIconGlyph = 'doc' | 'image' | 'video' | 'audio' | 'blank' | 'folder';

type Props = { readonly size: number; readonly glyph: FileIconGlyph };

const PATHS = {
  doc: 'M6 2h8l4 4v16H6z',
  image: 'M4 5h16v14H4zm2 10l4-4 3 3 3-3 4 4',
  video: 'M4 5h16v14H4zm6 3l6 4-6 4z',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  blank: 'M6 2h12v20H6z',
  folder: 'M3 6h7l2 3h9v11H3z',
} satisfies Record<FileIconGlyph, string>;

const PREVIEW_ICON_SIZE = parseInt(token('sizes.filePreviewIcon'), 10);

export const FileIcon = ({ size, glyph }: Props) => (
  // fill="none" / stroke="currentColor" だけを SVG のプレゼンテーション属性として
  // 直接指定する(理由は styles.css.ts のコメント参照)。currentColor の実効色は
  // 祖先の `color` に依存する — 今日は global-css.ts の `html { color: fg.default }`
  // に解決されるが、この経路自体はテストで縛られていない(report 参照)。
  <svg className={s.icon} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" data-glyph={glyph}>
    <path d={PATHS[glyph]} />
  </svg>
);

export const FilePreviewIcon = ({ glyph }: { readonly glyph: FileIconGlyph }) => <FileIcon size={PREVIEW_ICON_SIZE} glyph={glyph} />;
