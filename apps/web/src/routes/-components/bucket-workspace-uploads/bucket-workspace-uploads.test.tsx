import Uppy from '@uppy/core';
import { createApiClient } from '@r2-drive/api/client';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BucketWorkspaceUploads } from './index';
import { getObjectRowId } from '../object-list/row-id';
import { UploadSessionBoundary } from '../upload-session-boundary/index';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';
import type { DragAndDropOptions, DroppableCollectionRootDropEvent, FileDropItem, Selection } from 'react-aria-components';
import type { R2Uploader, UploadBody, UploadMeta } from '../../../upload/create-uploader/index';
import type { ViewMode } from '../gallery/resolve-view-mode';

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

const image = (key: string): ObjectDescriptor => ({
  bucketId: 'photos',
  key,
  name: key,
  contentType: 'image/png',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: '"x"',
  media: { kind: 'image', width: 800, height: 600 },
});

type WorkspaceOverrides = {
  readonly objects?: readonly ObjectDescriptor[];
  readonly viewMode?: ViewMode;
  readonly onViewModeChange?: (mode: ViewMode) => void;
  readonly selectedKeys?: Selection;
  readonly onDeleteRequest?: () => void;
};

const renderWorkspace = (uppy: R2Uploader, overrides: WorkspaceOverrides = {}) =>
  render(
    <UploadSessionBoundary client={client} bucketId="photos" prefix="docs/" onUploadSuccess={() => undefined} uploaderFactory={() => uppy}>
      <BucketWorkspaceUploads
        bucketId="photos"
        prefix="docs/"
        folders={[]}
        objects={overrides.objects ?? []}
        getContentUrl={() => '/unused'}
        viewMode={overrides.viewMode ?? 'tiles'}
        onViewModeChange={overrides.onViewModeChange ?? (() => undefined)}
        selectedKeys={overrides.selectedKeys ?? new Set()}
        onSelectionChange={() => undefined}
        onDeleteRequest={overrides.onDeleteRequest ?? (() => undefined)}
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

  it('gallery mode でも GalleryView の root drop が同じ現在 session へ File を追加する(spec §6.2)', async () => {
    const uppy = createSession();
    renderWorkspace(uppy, { viewMode: 'gallery', objects: [image('docs/a.png')] });

    if (rootDropCapture.current.kind !== 'captured') throw new Error('GalleryView did not register onRootDrop');
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

    expect(uppy.getFiles().map((file) => file.name)).toEqual(['dropped.txt']);
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

  it('viewMode="gallery" は ObjectList ではなく GalleryView を描画する', () => {
    const uppy = createSession();
    const { container } = renderWorkspace(uppy, { viewMode: 'gallery', objects: [image('docs/a.png')] });

    expect(screen.queryByRole('grid', { name: 'オブジェクト一覧' })).toBeNull();
    expect(container.querySelector('img[src="/unused"]')).toBeTruthy();
  });

  it('トグルの押下で onViewModeChange が次の mode で呼ばれる', async () => {
    const uppy = createSession();
    const onViewModeChange = vi.fn();
    const user = userEvent.setup();
    renderWorkspace(uppy, { viewMode: 'tiles', onViewModeChange });

    await user.click(screen.getByRole('radio', { name: 'ギャラリー' }));

    expect(onViewModeChange).toHaveBeenCalledWith('gallery');
  });

  it('gallery mode でも選択済みで Delete を押すと onDeleteRequest が呼ばれる(object-list と同じ経路)', async () => {
    const uppy = createSession();
    const onDeleteRequest = vi.fn();
    const target = image('docs/a.png');
    const user = userEvent.setup();
    const { container } = renderWorkspace(uppy, { viewMode: 'gallery', objects: [target], selectedKeys: new Set([getObjectRowId(target)]), onDeleteRequest });

    const cell = container.querySelector('img')?.closest('[role="row"]');
    if (!(cell instanceof HTMLElement)) throw new Error('gallery image cell was not rendered');
    cell.focus();
    await user.keyboard('{Delete}');

    expect(onDeleteRequest).toHaveBeenCalled();
  });
});
