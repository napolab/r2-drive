import { useCallback, useState } from 'react';

import { resolvePlayback } from '../../playback/registry';
import { MediaLoadError } from '../media-load-error';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const VideoViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [loadError, setLoadError] = useState<MediaLoadError | undefined>(undefined);
  const handleError = useCallback(() => setLoadError(new MediaLoadError('動画を読み込めませんでした')), []);

  // video の onError は ErrorBoundary に届かないので、いったん state に落として
  // render 中に throw する。overlay 側の ViewerErrorBoundary がここで拾う。
  if (loadError !== undefined) throw loadError;

  return resolvePlayback({ object, getContentUrl }).match(
    (playback) => {
      switch (playback.kind) {
        case 'raw':
          // Range 再生・シーク・PiP・キーボード操作はブラウザ実装に任せる(ネイティブ controls)。
          return <video className={styles.viewerVideo} controls preload="metadata" src={playback.src} onError={handleError} />;
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

export default VideoViewer;
