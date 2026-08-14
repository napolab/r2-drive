import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

export const imagePlugin: FileTypePlugin = {
  id: 'image',
  run: (object) => (object.contentType.startsWith('image/') ? ok({ typeId: 'image', label: '画像', Icon: (props) => <FileIcon {...props} glyph="image" /> }) : err(object)),
};
