import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@r2-drive/api/client';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback } from 'react';
import { Button } from 'react-aria-components';
import { afterEach, describe, expect, it } from 'vitest';

import { useUploaderSession } from '../upload-session-boundary/index';
import { BucketUploadSession } from './index';

import type { ApiClient } from '@r2-drive/api/client';

afterEach(cleanup);

const client: ApiClient = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch });

const UploadSuccessProbe = () => {
  const uppy = useUploaderSession();
  const handlePress = useCallback(() => {
    uppy.emit('upload-success', undefined, { status: 200, body: {}, uploadURL: 'https://drive.test/api/buckets/photos/content/docs/file.txt' });
  }, [uppy]);

  return <Button onPress={handlePress}>upload success を通知</Button>;
};

describe('BucketUploadSession', () => {
  it('現在 bucket/prefix の object query だけを exact invalidate する', async () => {
    const queryClient = new QueryClient();
    const currentKey = ['api', '/api/buckets/photos/objects', '?prefix=docs%2F'] as const;
    const descendantKey = ['api', '/api/buckets/photos/objects', '?prefix=docs%2F', 'descendant'] as const;
    queryClient.setQueryData(currentKey, { source: 'current' });
    queryClient.setQueryData(descendantKey, { source: 'descendant' });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <BucketUploadSession client={client} bucketId="photos" prefix="docs/">
          <UploadSuccessProbe />
        </BucketUploadSession>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'upload success を通知' }));

    await waitFor(() => expect(queryClient.getQueryState(currentKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(descendantKey)?.isInvalidated).toBe(false);
    queryClient.clear();
  });
});
