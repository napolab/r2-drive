import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

export const videoPlugin: FileTypePlugin = {
  id: 'video',
  run: (object) => (object.contentType.startsWith('video/') ? ok({ typeId: 'video', label: '動画', Icon: (props) => <FileIcon {...props} glyph="video" /> }) : err(object)),
};
