import { err, ok } from 'neverthrow';
import { lazy, useCallback, useState } from 'react';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';
import * as styles from './styles.css';

import type { FileTypePlugin, PreviewProps } from '../types';

const ImageViewer = lazy(() => import('./viewer'));

const ImagePreview = ({ object, getContentUrl }: PreviewProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);

  if (hasLoadError) {
    return (
      <span data-preview-kind="icon">
        <FilePreviewIcon glyph="image" />
      </span>
    );
  }

  return <img className={styles.root} data-preview-kind="image" src={getContentUrl(object)} alt="" loading="lazy" decoding="async" draggable={false} onError={handleError} />;
};

export const imagePlugin: FileTypePlugin = {
  id: 'image',
  run: (object) =>
    object.contentType.startsWith('image/')
      ? ok({ typeId: 'image', label: '画像', Icon: (props) => <FileIcon {...props} glyph="image" />, Preview: ImagePreview, capability: { kind: 'view', Viewer: ImageViewer } })
      : err(object),
};
