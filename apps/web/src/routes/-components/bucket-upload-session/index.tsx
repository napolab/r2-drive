import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { objectsQuery } from '../../../queries/objects';
import { createUploader } from '../../../upload/create-uploader/index';
import { UploadSessionBoundary } from '../upload-session-boundary/index';

import type { ApiClient } from '@r2-drive/api/client';
import type { ReactNode } from 'react';

type Props = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly prefix: string;
  readonly children: ReactNode;
};

export const BucketUploadSession = ({ client, bucketId, prefix, children }: Props) => {
  const queryClient = useQueryClient();
  const sessionKey = JSON.stringify([bucketId, prefix]);
  const handleUploadSuccess = useCallback(() => {
    const queryKey = objectsQuery(client, bucketId, prefix).queryKey;
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }, [bucketId, client, prefix, queryClient]);

  return (
    <UploadSessionBoundary key={sessionKey} client={client} bucketId={bucketId} prefix={prefix} onUploadSuccess={handleUploadSuccess} uploaderFactory={createUploader}>
      {children}
    </UploadSessionBoundary>
  );
};
