import { err, ok } from 'neverthrow';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin, PreviewProps } from '../types';

const AudioPreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="audio" />
  </span>
);

export const audioPlugin: FileTypePlugin = {
  id: 'audio',
  run: (object) =>
    object.contentType.startsWith('audio/')
      ? // Task 5(video/audio)/ Task 10(markdown)で view に昇格する暫定値
        ok({ typeId: 'audio', label: '音声', Icon: (props) => <FileIcon {...props} glyph="audio" />, Preview: AudioPreview, capability: { kind: 'opaque' } })
      : err(object),
};
