import { err, ok } from 'neverthrow';
import { lazy } from 'react';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin, PreviewProps } from '../types';

const VideoViewer = lazy(() => import('./viewer'));

const VideoPreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="video" />
  </span>
);

export const videoPlugin: FileTypePlugin = {
  id: 'video',
  run: (object) =>
    object.contentType.startsWith('video/')
      ? ok({ typeId: 'video', label: '動画', Icon: (props) => <FileIcon {...props} glyph="video" />, Preview: VideoPreview, capability: { kind: 'view', Viewer: VideoViewer } })
      : err(object),
};
