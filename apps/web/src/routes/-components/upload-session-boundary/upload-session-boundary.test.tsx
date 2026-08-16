import { createApiClient } from '@r2-drive/api/client';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useCallback } from 'react';
import { Button } from 'react-aria-components';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUploader } from '../../../upload/create-uploader/index';
import { UploadSessionBoundary, useUploaderSession } from './index';

import type { ApiClient } from '@r2-drive/api/client';
import type { R2Uploader } from '../../../upload/create-uploader/index';

afterEach(cleanup);

const client: ApiClient = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch });

type ProbeProps = { readonly onUse: (uppy: R2Uploader) => void };

const SessionProbe = ({ onUse }: ProbeProps) => {
  const uppy = useUploaderSession();
  const handlePress = useCallback(() => onUse(uppy), [onUse, uppy]);

  return <Button onPress={handlePress}>現在の session を使う</Button>;
};

describe('UploadSessionBoundary', () => {
  it('StrictMode の ref cleanup 後は破棄済みではなく新しい Uppy を子へ渡す', async () => {
    const sessions: { readonly uppy: R2Uploader; readonly destroy: ReturnType<typeof vi.spyOn> }[] = [];
    const uploaderFactory: typeof createUploader = (options) => {
      const uppy = createUploader(options);
      const destroy = vi.spyOn(uppy, 'destroy');
      sessions.push({ uppy, destroy });
      return uppy;
    };
    const onUse = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <UploadSessionBoundary client={client} bucketId="photos" prefix="docs/" onUploadSuccess={vi.fn()} uploaderFactory={uploaderFactory}>
          <SessionProbe onUse={onUse} />
        </UploadSessionBoundary>
      </StrictMode>,
    );

    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const [discarded] = sessions;
    const active = sessions.at(-1);
    if (discarded === undefined || active === undefined) throw new Error('StrictMode sessions were not created');
    expect(discarded.destroy).toHaveBeenCalledOnce();
    expect(active.destroy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '現在の session を使う' }));
    expect(onUse).toHaveBeenLastCalledWith(active.uppy);

    unmount();
    expect(active.destroy).toHaveBeenCalledOnce();
  });
});
