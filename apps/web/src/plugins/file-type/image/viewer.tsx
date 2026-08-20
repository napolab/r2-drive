import { useCallback, useState } from 'react';

import { MediaLoadError } from '../media-load-error';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const ImageViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [loadError, setLoadError] = useState<MediaLoadError | undefined>(undefined);
  const handleError = useCallback(() => setLoadError(new MediaLoadError('画像を読み込めませんでした')), []);

  // img の onError は ErrorBoundary に届かないので、いったん state に落として
  // render 中に throw する。overlay 側の ViewerErrorBoundary がここで拾う。
  if (loadError !== undefined) throw loadError;

  return <img className={styles.viewerImage} src={getContentUrl(object)} alt={object.name} onError={handleError} />;
};

export default ImageViewer;
