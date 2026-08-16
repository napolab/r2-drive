import { err, ok } from 'neverthrow';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin, PreviewProps } from '../types';

const EXTENSIONS = ['.md', '.mdx', '.markdown'];

const MarkdownPreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="doc" />
  </span>
);

export const markdownPlugin: FileTypePlugin = {
  id: 'markdown',
  run: (object) =>
    EXTENSIONS.some((ext) => object.name.toLowerCase().endsWith(ext)) || object.contentType === 'text/markdown'
      ? ok({ typeId: 'markdown', label: 'Markdown', Icon: (props) => <FileIcon {...props} glyph="doc" />, Preview: MarkdownPreview })
      : err(object),
};
