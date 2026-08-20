import Uppy from '@uppy/core';
import { createApiClient } from '@r2-drive/api/client';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BucketWorkspaceUploads } from './index';
import { UploadSessionBoundary } from '../upload-session-boundary/index';

import type { ApiClient } from '@r2-drive/api/client';
import type { DragAndDropOptions, DroppableCollectionRootDropEvent, FileDropItem } from 'react-aria-components';
import type { R2Uploader, UploadBody, UploadMeta } from '../../../upload/create-uploader/index';

type RootDropHandler = (event: DroppableCollectionRootDropEvent) => void;
type RootDropCapture = { readonly kind: 'empty' } | { readonly kind: 'captured'; readonly handler: RootDropHandler };

const rootDropCapture = vi.hoisted((): { current: RootDropCapture } => ({ current: { kind: 'empty' } }));

vi.mock('react-aria-components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-aria-components')>();

  return {
    ...actual,
    useDragAndDrop: <T,>(options: DragAndDropOptions<T>) => {
      if (options.onRootDrop !== undefined) rootDropCapture.current = { kind: 'captured', handler: options.onRootDrop };
      return actual.useDragAndDrop(options);
    },
  };
});

beforeEach(() => {
  rootDropCapture.current = { kind: 'empty' };
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 600 },
    clientHeight: { configurable: true, get: () => 600 },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

const createSession = (): R2Uploader => new Uppy<UploadMeta, UploadBody>({ autoProceed: false, meta: { prefix: 'docs/' } });
const client: ApiClient = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch });

const renderWorkspace = (uppy: R2Uploader) =>
  render(
    <UploadSessionBoundary client={client} bucketId="photos" prefix="docs/" onUploadSuccess={() => undefined} uploaderFactory={() => uppy}>
      <BucketWorkspaceUploads
        bucketId="photos"
        prefix="docs/"
        folders={[]}
        objects={[]}
        getContentUrl={() => '/unused'}
        selectedKeys={new Set()}
        onSelectionChange={() => undefined}
        onDeleteRequest={() => undefined}
        onObjectContextMenu={() => undefined}
        actionNotice={{ kind: 'none' }}
        onOpenFolder={() => undefined}
        onPrefetchFolder={() => undefined}
        onOpenObject={() => undefined}
        onLoadMore={() => undefined}
        isLoadingMore={false}
      />
    </UploadSessionBoundary>,
  );

describe('BucketWorkspaceUploads', () => {
  it('FileTrigger と ObjectList root drop が同じ現在 session へ File を追加する', async () => {
    const uppy = createSession();
    const user = userEvent.setup();
    const { container } = renderWorkspace(uppy);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('FileTrigger input was not rendered');

    const pickerFile = new File(['picker'], 'picker.txt', { type: 'text/plain' });
    await user.upload(input, pickerFile);
    expect(uppy.getFiles().map((file) => file.name)).toEqual(['picker.txt']);

    if (rootDropCapture.current.kind !== 'captured') throw new Error('ObjectList did not register onRootDrop');
    const { handler } = rootDropCapture.current;
    const droppedFile = new File(['drop'], 'dropped.txt', { type: 'text/plain' });
    const droppedItem: FileDropItem = {
      kind: 'file',
      type: 'text/plain',
      name: 'dropped.txt',
      getFile: async () => droppedFile,
      getText: async () => 'drop',
    };

    await act(async () => {
      await handler({ items: [droppedItem], dropOperation: 'copy' });
    });

    expect(uppy.getFiles().map((file) => file.name)).toEqual(['picker.txt', 'dropped.txt']);
  });

  it('UploadTray のキーボード中断が現在 session から対象 file を remove する', async () => {
    const uppy = createSession();
    const user = userEvent.setup();

    uppy.addFile({ name: 'cancel.bin', type: 'application/octet-stream', data: new Blob(['cancel']) });
    renderWorkspace(uppy);
    const cancel = await screen.findByRole('button', { name: 'cancel.bin を中断' });

    cancel.focus();
    await user.keyboard('{Enter}');

    expect(uppy.getFiles()).toEqual([]);
  });
});
