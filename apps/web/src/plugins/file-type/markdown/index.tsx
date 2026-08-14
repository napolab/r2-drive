import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

const EXTENSIONS = ['.md', '.mdx', '.markdown'];

export const markdownPlugin: FileTypePlugin = {
  id: 'markdown',
  run: (object) =>
    EXTENSIONS.some((ext) => object.name.toLowerCase().endsWith(ext)) || object.contentType === 'text/markdown'
      ? ok({ typeId: 'markdown', label: 'Markdown', Icon: (props) => <FileIcon {...props} glyph="doc" /> })
      : err(object),
};
