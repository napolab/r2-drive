import { err, ok } from 'neverthrow';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin, PreviewProps } from '../types';

const VideoPreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="video" />
  </span>
);

export const videoPlugin: FileTypePlugin = {
  id: 'video',
  run: (object) =>
    object.contentType.startsWith('video/')
      ? // Task 5(video/audio)/ Task 10(markdown)で view に昇格する暫定値
        ok({ typeId: 'video', label: '動画', Icon: (props) => <FileIcon {...props} glyph="video" />, Preview: VideoPreview, capability: { kind: 'opaque' } })
      : err(object),
};
