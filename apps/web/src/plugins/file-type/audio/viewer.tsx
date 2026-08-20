import { useCallback, useState } from 'react';
import { Link } from 'react-aria-components';

import { resolvePlayback } from '../../playback/registry';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const MediaLoadFailure = ({ object, getContentUrl, message }: ViewerProps & { readonly message: string }) => (
  <div className={styles.viewerErrorRoot} role="alert">
    <p>{message}</p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);

const AudioViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);

  if (hasLoadError) return <MediaLoadFailure object={object} getContentUrl={getContentUrl} message="音声を読み込めませんでした" />;

  return resolvePlayback({ object, getContentUrl }).match(
    (playback) => {
      switch (playback.kind) {
        case 'raw':
          return (
            <div className={styles.viewerAudioRoot}>
              <p className={styles.viewerAudioName}>{object.name}</p>
              <audio className={styles.viewerAudio} controls preload="metadata" src={playback.src} onError={handleError} />
            </div>
          );
        default: {
          const _exhaustive: never = playback.kind;
          throw new Error(`unhandled playback: ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
    () => <MediaLoadFailure object={object} getContentUrl={getContentUrl} message="再生ソースを解決できませんでした" />,
  );
};

export default AudioViewer;
