import { err, ok } from 'neverthrow';
import { lazy } from 'react';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin, PreviewProps } from '../types';

const AudioViewer = lazy(() => import('./viewer'));

const AudioPreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="audio" />
  </span>
);

export const audioPlugin: FileTypePlugin = {
  id: 'audio',
  run: (object) =>
    object.contentType.startsWith('audio/')
      ? ok({ typeId: 'audio', label: '音声', Icon: (props) => <FileIcon {...props} glyph="audio" />, Preview: AudioPreview, capability: { kind: 'view', Viewer: AudioViewer } })
      : err(object),
};
