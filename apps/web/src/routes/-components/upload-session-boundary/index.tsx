import { createContext, useCallback, useContext, useState } from 'react';

import { createUploader } from '../../../upload/create-uploader/index';
import * as styles from './styles.css';

import type { ApiClient } from '@r2-drive/api/client';
import type { ReactNode } from 'react';
import type { R2Uploader } from '../../../upload/create-uploader/index';

type Props = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly prefix: string;
  readonly onUploadSuccess: () => void;
  readonly uploaderFactory: typeof createUploader;
  readonly children: ReactNode;
};

type SessionState = { readonly kind: 'pending' } | { readonly kind: 'ready'; readonly uppy: R2Uploader };

const UploaderSessionContext = createContext<R2Uploader | undefined>(undefined);

class MissingUploaderSessionError extends Error {
  override name = 'MissingUploaderSessionError';
}

export const useUploaderSession = (): R2Uploader => {
  const uppy = useContext(UploaderSessionContext);
  if (uppy === undefined) throw new MissingUploaderSessionError('UploadSessionBoundary is missing');
  return uppy;
};

export const UploadSessionBoundary = ({ client, bucketId, prefix, onUploadSuccess, uploaderFactory, children }: Props) => {
  const [session, setSession] = useState<SessionState>({ kind: 'pending' });

  // React 19 の ref cleanup を resource lifetime に使う。render 中には Uppy を作らないため、
  // StrictMode の捨てられる render で window listener が漏れない。ref の
  // setup → cleanup → setup では最初の instance を destroy してから新しい値へ置き換える。
  const handleSessionRoot = useCallback(
    (root: HTMLDivElement | null) => {
      if (root === null) return;

      const uppy = uploaderFactory({ client, bucketId, prefix, onUploadSuccess });
      setSession({ kind: 'ready', uppy });

      return () => {
        uppy.destroy();
        setSession((current) => (current.kind === 'ready' && current.uppy === uppy ? { kind: 'pending' } : current));
      };
    },
    [bucketId, client, onUploadSuccess, prefix, uploaderFactory],
  );

  return (
    <div className={styles.root} ref={handleSessionRoot}>
      {session.kind === 'ready' ? <UploaderSessionContext value={session.uppy}>{children}</UploaderSessionContext> : null}
    </div>
  );
};
