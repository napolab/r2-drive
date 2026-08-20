import { useCallback, useState } from 'react';
import { Link } from 'react-aria-components';

import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const ImageViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);

  if (hasLoadError) {
    return (
      <div className={styles.viewerErrorRoot} role="alert">
        <p>画像を読み込めませんでした</p>
        <Link href={getContentUrl(object)} download={object.name}>
          ダウンロード
        </Link>
      </div>
    );
  }

  return <img className={styles.viewerImage} src={getContentUrl(object)} alt={object.name} onError={handleError} />;
};

export default ImageViewer;
