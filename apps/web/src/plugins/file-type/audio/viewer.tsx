import { useCallback, useState } from 'react';

import { resolvePlayback } from '../../playback/registry';
import { MediaLoadError } from '../media-load-error';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const AudioViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [loadError, setLoadError] = useState<MediaLoadError | undefined>(undefined);
  const handleError = useCallback(() => setLoadError(new MediaLoadError('音声を読み込めませんでした')), []);

  // audio の onError は ErrorBoundary に届かないので、いったん state に落として
  // render 中に throw する。overlay 側の ViewerErrorBoundary がここで拾う。
  if (loadError !== undefined) throw loadError;

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
    () => {
      // render 中の throw で ViewerErrorBoundary に委譲する。
      throw new MediaLoadError('再生ソースを解決できませんでした');
    },
  );
};

export default AudioViewer;
