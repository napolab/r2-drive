import Uppy from '@uppy/core';
import { createApiClient } from '@r2-drive/api/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from 'neverthrow';

import { objectsQuery } from '../../../queries/objects';
import { objectActions } from '../../../plugins/object-action/registry';
import { BucketObjectActions } from './index';
import { UploadSessionBoundary } from '../upload-session-boundary/index';

import type { ApiClient } from '@r2-drive/api/client';
import type { FolderDescriptor, ObjectDescriptor, ObjectPage } from '@r2-drive/core';
import type { InfiniteData } from '@tanstack/react-query';
import type { R2Uploader, UploadBody, UploadMeta } from '../../../upload/create-uploader/index';
import type { ObjectAction } from '../../../plugins/object-action/types';

const deleteClientState = vi.hoisted((): { current: ApiClient | undefined } => ({ current: undefined }));

vi.mock('../../../api/client', () => ({
  getApiClient: () => {
    if (deleteClientState.current === undefined) throw new Error('delete client was not configured');
    return deleteClientState.current;
  },
}));

const client: ApiClient = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch });
const objects: readonly ObjectDescriptor[] = ['a.txt', 'b.txt', 'c.txt'].map((key) => ({
  bucketId: 'photos',
  key: `docs/${key}`,
  name: key,
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: key,
}));
const folders: readonly FolderDescriptor[] = [{ bucketId: 'photos', prefix: 'docs/archive/', name: 'archive' }];

const createDeferredResponse = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const createSession = (): R2Uploader => new Uppy<UploadMeta, UploadBody>({ autoProceed: false, meta: { prefix: 'docs/' } });

const createData = (): InfiniteData<ObjectPage, string | undefined> => ({
  pages: [{ folders: [], objects, next: { kind: 'end' } }],
  pageParams: [undefined],
});

const getCachedObjectKeys = (queryClient: QueryClient, queryKey: ReturnType<typeof objectsQuery>['queryKey']): readonly string[] =>
  queryClient.getQueryData<InfiniteData<ObjectPage, string | undefined>>(queryKey)?.pages.flatMap((page) => page.objects.map((object) => object.key)) ?? [];

type Rows = { readonly folders: readonly FolderDescriptor[]; readonly objects: readonly ObjectDescriptor[] };

const selectAllShortcut = navigator.platform.toLowerCase().includes('mac') ? '{Meta>}a{/Meta}' : '{Control>}a{/Control}';

const renderActions = (queryClient: QueryClient, rows: Rows) => {
  const uppy = createSession();
  const buildTree = (nextRows: Rows) => (
    <QueryClientProvider client={queryClient}>
      <UploadSessionBoundary client={client} bucketId="photos" prefix="docs/" onUploadSuccess={vi.fn()} uploaderFactory={() => uppy}>
        <BucketObjectActions
          client={client}
          bucketId="photos"
          prefix="docs/"
          folders={nextRows.folders}
          objects={nextRows.objects}
          getContentUrl={() => '/content'}
          onOpenFolder={vi.fn()}
          onPrefetchFolder={vi.fn()}
          onOpenObject={vi.fn()}
          onLoadMore={vi.fn()}
          isLoadingMore={false}
        />
      </UploadSessionBoundary>
    </QueryClientProvider>
  );
  const result = render(buildTree(rows));
  // 同じ Uppy インスタンス・同じ render ツリーを保ったまま folders/objects だけ差し替える。
  // b.$bucketId.$.tsx の fetchNextPage 相当(同一インスタンスのまま props が伸びる)を再現する。
  const rerenderRows = (nextRows: Rows) => result.rerender(buildTree(nextRows));
  return { ...result, uppy, rerenderRows };
};

beforeEach(() => {
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 600 },
    clientHeight: { configurable: true, get: () => 600 },
  });
  deleteClientState.current = undefined;
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

describe('BucketObjectActions', () => {
  it('keyboard delete を楽観反映し、成功後に current query だけ exact invalidate する', async () => {
    const deferred = createDeferredResponse();
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return deferred.promise;
    };
    deleteClientState.current = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch: fakeFetch });
    const queryClient = new QueryClient();
    const queryKey = objectsQuery(client, 'photos', 'docs/').queryKey;
    const descendantKey = [...queryKey, 'descendant'] as const;
    queryClient.setQueryData(queryKey, createData());
    queryClient.setQueryData(descendantKey, { source: 'descendant' });
    const user = userEvent.setup();
    renderActions(queryClient, { folders: [], objects });

    const firstTile = (await screen.findByText('a.txt')).closest('[data-kind="object"]');
    if (!(firstTile instanceof HTMLElement)) throw new Error('object tile was not rendered');
    firstTile.focus();
    await user.keyboard(' {Delete}');
    await user.click(await screen.findByRole('button', { name: '削除' }));

    await waitFor(() => expect(getCachedObjectKeys(queryClient, queryKey)).toEqual(['docs/b.txt', 'docs/c.txt']));
    expect(requests).toHaveLength(1);

    await act(async () => deferred.resolve(new Response(JSON.stringify({ deleted: ['docs/a.txt'] }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(descendantKey)?.isInvalidated).toBe(false);
    queryClient.clear();
  });

  it('delete failure で snapshot を戻し dialog に retryable error を残す', async () => {
    const deferred = createDeferredResponse();
    const fakeFetch: typeof fetch = async () => deferred.promise;
    deleteClientState.current = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch: fakeFetch });
    const queryClient = new QueryClient();
    const queryKey = objectsQuery(client, 'photos', 'docs/').queryKey;
    queryClient.setQueryData(queryKey, createData());
    const user = userEvent.setup();
    renderActions(queryClient, { folders: [], objects });

    const firstTile = (await screen.findByText('a.txt')).closest('[data-kind="object"]');
    if (!(firstTile instanceof HTMLElement)) throw new Error('object tile was not rendered');
    firstTile.focus();
    await user.keyboard(' {Delete}');
    await user.click(await screen.findByRole('button', { name: '削除' }));
    await waitFor(() => expect(getCachedObjectKeys(queryClient, queryKey)).toEqual(['docs/b.txt', 'docs/c.txt']));

    await act(async () => deferred.resolve(new Response(JSON.stringify({ name: 'InternalError', message: 'R2 refused delete' }), { status: 500, headers: { 'content-type': 'application/json' } })));

    await waitFor(() => expect(getCachedObjectKeys(queryClient, queryKey)).toEqual(['docs/a.txt', 'docs/b.txt', 'docs/c.txt']));
    expect((await screen.findByRole('alert')).textContent).toContain('R2 refused delete');
    expect(screen.getByRole('button', { name: '削除を再試行' })).toBeTruthy();
    queryClient.clear();
  });

  it('folder selection の keyboard delete は API を呼ばず未対応を知らせる', async () => {
    const fakeFetch = vi.fn<typeof fetch>();
    deleteClientState.current = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch: fakeFetch });
    const queryClient = new QueryClient();
    const user = userEvent.setup();
    renderActions(queryClient, { folders, objects: [] });

    const folderTile = (await screen.findByText('archive')).closest('[data-kind="folder"]');
    if (!(folderTile instanceof HTMLElement)) throw new Error('folder tile was not rendered');
    folderTile.focus();
    await user.keyboard(' {Delete}');

    expect((await screen.findByRole('alert')).textContent).toContain('フォルダの削除');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fakeFetch).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it('context menu は file-only multi selection を維持し、未選択 file では置き換える', async () => {
    deleteClientState.current = client;
    const queryClient = new QueryClient();
    const user = userEvent.setup();
    renderActions(queryClient, { folders: [], objects });
    const first = await screen.findByText('a.txt');
    const second = screen.getByText('b.txt');
    const third = screen.getByText('c.txt');

    const firstTile = first.closest('[data-kind="object"]');
    const secondTile = second.closest('[data-kind="object"]');
    const thirdTile = third.closest('[data-kind="object"]');
    if (!(firstTile instanceof HTMLElement) || !(secondTile instanceof HTMLElement) || !(thirdTile instanceof HTMLElement)) throw new Error('object tiles were not rendered');
    firstTile.focus();
    await user.keyboard(' ');
    await user.keyboard('{Control>}{Meta>}');
    await user.click(secondTile);
    await user.keyboard('{/Meta}{/Control}');
    await waitFor(() => expect(firstTile.hasAttribute('data-selected')).toBe(true));
    expect(secondTile.hasAttribute('data-selected')).toBe(true);

    fireEvent.contextMenu(secondTile, { clientX: 100, clientY: 100 });
    await screen.findByRole('menu');
    expect(firstTile.hasAttribute('data-selected')).toBe(true);
    expect(secondTile.hasAttribute('data-selected')).toBe(true);
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(thirdTile, { clientX: 120, clientY: 120 });
    await screen.findByRole('menu');
    expect(firstTile.hasAttribute('data-selected')).toBe(false);
    expect(secondTile.hasAttribute('data-selected')).toBe(false);
    expect(thirdTile.hasAttribute('data-selected')).toBe(true);
    queryClient.clear();
  });

  it('delete 以外の destructive action を delete dialog に変換しない', async () => {
    deleteClientState.current = client;
    const queryClient = new QueryClient();
    const runArchive = vi.fn(async () => undefined);
    const archiveAction: ObjectAction = {
      id: 'archive',
      run: (selection) => (selection.actionId === 'archive' ? ok({ actionId: 'archive', label: 'アーカイブ', destructive: true, run: runArchive }) : err(selection)),
    };
    Reflect.apply(Array.prototype.push, objectActions, [archiveAction]);

    try {
      const user = userEvent.setup();
      renderActions(queryClient, { folders: [], objects });
      const firstTile = (await screen.findByText('a.txt')).closest('[data-kind="object"]');
      if (!(firstTile instanceof HTMLElement)) throw new Error('object tile was not rendered');

      fireEvent.contextMenu(firstTile, { clientX: 100, clientY: 100 });
      await user.click(await screen.findByRole('menuitem', { name: 'アーカイブ' }));

      await waitFor(() => expect(runArchive).toHaveBeenCalledWith([objects[0]]));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    } finally {
      Reflect.apply(Array.prototype.pop, objectActions, []);
      queryClient.clear();
    }
  });

  it('Select All のあと届いた行も削除対象になる', async () => {
    const fakeFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ deleted: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    deleteClientState.current = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch: fakeFetch });
    const queryClient = new QueryClient();
    const twoObjects = objects.slice(0, 2);
    const user = userEvent.setup();
    const { rerenderRows } = renderActions(queryClient, { folders: [], objects: twoObjects });

    const firstTile = (await screen.findByText('a.txt')).closest('[data-kind="object"]');
    if (!(firstTile instanceof HTMLElement)) throw new Error('object tile was not rendered');
    await user.click(firstTile);
    await user.keyboard(selectAllShortcut);

    // fetchNextPage 相当。select all の後にページが増えて 3 件目が届く。
    rerenderRows({ folders: [], objects });
    await screen.findByText('c.txt');

    await user.keyboard('{Delete}');

    expect(await screen.findByText('3 件を削除しますか')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '削除' }));

    await waitFor(() => expect(fakeFetch).toHaveBeenCalledTimes(3));
    const requestedPaths = fakeFetch.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : `${input}`).pathname);
    expect(requestedPaths.some((path) => path.endsWith('docs/c.txt'))).toBe(true);
    queryClient.clear();
  });

  it('Select All のあと folder が届いたら削除を止める', async () => {
    const fakeFetch = vi.fn<typeof fetch>();
    deleteClientState.current = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch: fakeFetch });
    const queryClient = new QueryClient();
    const twoObjects = objects.slice(0, 2);
    const user = userEvent.setup();
    const { rerenderRows } = renderActions(queryClient, { folders: [], objects: twoObjects });

    const firstTile = (await screen.findByText('a.txt')).closest('[data-kind="object"]');
    if (!(firstTile instanceof HTMLElement)) throw new Error('object tile was not rendered');
    await user.click(firstTile);
    await user.keyboard(selectAllShortcut);

    // select all の時点では folders が空だったが、後から folder が届く。
    rerenderRows({ folders, objects: twoObjects });
    await screen.findByText('archive');

    await user.keyboard('{Delete}');

    expect((await screen.findByRole('alert')).textContent).toContain('フォルダの削除');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fakeFetch).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it('context menu を開いたまま行が変わっても最新で解決する', async () => {
    deleteClientState.current = client;
    const queryClient = new QueryClient();
    const runArchive = vi.fn(async () => undefined);
    const archiveAction: ObjectAction = {
      id: 'archive',
      run: (selection) => (selection.actionId === 'archive' ? ok({ actionId: 'archive', label: 'アーカイブ', destructive: true, run: runArchive }) : err(selection)),
    };
    Reflect.apply(Array.prototype.push, objectActions, [archiveAction]);

    try {
      const user = userEvent.setup();
      const { rerenderRows } = renderActions(queryClient, { folders: [], objects });
      const first = await screen.findByText('a.txt');
      const second = screen.getByText('b.txt');

      const firstTile = first.closest('[data-kind="object"]');
      const secondTile = second.closest('[data-kind="object"]');
      if (!(firstTile instanceof HTMLElement) || !(secondTile instanceof HTMLElement)) throw new Error('object tiles were not rendered');
      await user.click(firstTile);
      await user.keyboard('{Control>}{Meta>}');
      await user.click(secondTile);
      await user.keyboard('{/Meta}{/Control}');

      fireEvent.contextMenu(secondTile, { clientX: 100, clientY: 100 });
      await screen.findByRole('menu');

      // メニューを開いたまま、選択していた a.txt が rows から消える。
      const remainingObjects = objects.filter((object) => object.name !== 'a.txt');
      rerenderRows({ folders: [], objects: remainingObjects });

      await user.click(await screen.findByRole('menuitem', { name: 'アーカイブ' }));

      await waitFor(() => expect(runArchive).toHaveBeenCalledWith([remainingObjects[0]]));
    } finally {
      Reflect.apply(Array.prototype.pop, objectActions, []);
      queryClient.clear();
    }
  });
});
