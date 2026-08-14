import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

export const audioPlugin: FileTypePlugin = {
  id: 'audio',
  run: (object) => (object.contentType.startsWith('audio/') ? ok({ typeId: 'audio', label: '音声', Icon: (props) => <FileIcon {...props} glyph="audio" /> }) : err(object)),
};
