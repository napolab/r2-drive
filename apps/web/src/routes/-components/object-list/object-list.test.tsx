import { NO_MEDIA } from '@r2-drive/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectList } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';
import type { ComponentProps } from 'react';
import type { Selection } from 'react-aria-components';

// GridLayout は viewport 幅から列数を決める。jsdom の clientWidth/clientHeight は常に
// 0 なので、実ブラウザ相当の scroll viewport をこの component test だけに与える。
beforeEach(() => {
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 600 },
    clientHeight: { configurable: true, get: () => 600 },
  });
});

// vitest は globals: false なので @testing-library/react の自動 cleanup が登録されない。
// 登録しないと前のテストの DOM が残り、getByText が複数一致で落ちる。
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

const objects: readonly ObjectDescriptor[] = Array.from({ length: 5 }, (_, i) => ({
  bucketId: 'photos',
  key: `f${i}.txt`,
  name: `f${i}.txt`,
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: `e${i}`,
  media: NO_MEDIA,
}));

const [firstObject, secondObject] = objects;
if (firstObject === undefined || secondObject === undefined) throw new Error('object fixtures were not created');

const noop = () => undefined;
const getContentUrl = (object: ObjectDescriptor) => `/api/buckets/${object.bucketId}/content/${object.key}`;
const getVersionedContentUrl = (object: ObjectDescriptor) => `/api/buckets/${object.bucketId}/content/${object.key}?etag=${object.etag}`;

const image: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'cover image.png',
  name: 'cover image.png',
  contentType: 'image/png',
  size: 128,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'cover',
  media: NO_MEDIA,
};

// onOpenObject の view/opaque 分岐だけを検証するための最小 fixture。
const make = (name: string, contentType: string): ObjectDescriptor => ({
  bucketId: 'photos',
  key: name,
  name,
  contentType,
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: name,
  media: NO_MEDIA,
});

type ControlledObjectListProps = Omit<ComponentProps<typeof ObjectList>, 'selectedKeys' | 'onSelectionChange'> & {
  readonly onSelectionChange: (keys: Selection) => void;
};

const ControlledObjectList = ({ onSelectionChange, ...props }: ControlledObjectListProps) => {
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const handleSelectionChange = useCallback(
    (keys: Selection) => {
      setSelectedKeys(keys);
      onSelectionChange(keys);
    },
    [onSelectionChange],
  );

  return <ObjectList {...props} selectedKeys={selectedKeys} onSelectionChange={handleSelectionChange} />;
};

const getLastSelection = (onSelectionChange: ReturnType<typeof vi.fn>): Set<React.Key> => {
  const selection: unknown = onSelectionChange.mock.calls.at(-1)?.[0];
  if (!(selection instanceof Set)) throw new Error('selection was not a Set');
  return selection;
};

// ObjectList の必須 props をデフォルト埋めして render する。onAction の分岐だけを
// 見たいテストで selection / delete / context menu 系 props を毎回書かないため。
const renderObjectList = (overrides: Partial<ComponentProps<typeof ObjectList>>) => {
  render(
    <ObjectList
      folders={[]}
      objects={[]}
      getContentUrl={getContentUrl}
      selectedKeys={new Set()}
      onSelectionChange={vi.fn()}
      onDeleteRequest={noop}
      onObjectContextMenu={noop}
      onOpenFolder={vi.fn()}
      onPrefetchFolder={noop}
      onExternalFiles={noop}
      onExternalFileError={noop}
      onOpenObject={noop}
      onLoadMore={noop}
      isLoadingMore={false}
      {...overrides}
    />,
  );
};

describe('ObjectList', () => {
  it('オブジェクト名を並べる', () => {
    render(
      <ControlledObjectList
        folders={[]}
        objects={objects}
        getContentUrl={getContentUrl}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    expect(screen.getByText('f0.txt')).toBeTruthy();
  });

  it('controlled selection を GridList の選択表示へ反映する', () => {
    render(
      <ObjectList
        folders={[]}
        objects={objects}
        getContentUrl={getContentUrl}
        selectedKeys={new Set(['f:f0.txt'])}
        onSelectionChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        onObjectContextMenu={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    expect(screen.getByText('f0.txt').closest('[data-kind="object"]')?.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByText('f1.txt').closest('[data-kind="object"]')?.hasAttribute('data-selected')).toBe(false);
  });

  it.each(['Delete', 'Backspace'])('%s で選択対象の削除を依頼する', async (key) => {
    const onDeleteRequest = vi.fn();
    render(
      <ObjectList
        folders={[]}
        objects={objects}
        getContentUrl={getContentUrl}
        selectedKeys={new Set(['f:f0.txt'])}
        onSelectionChange={vi.fn()}
        onDeleteRequest={onDeleteRequest}
        onObjectContextMenu={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard(`{${key}}`);

    expect(onDeleteRequest).toHaveBeenCalledOnce();
  });

  it('file の context menu を object と viewport 座標へ変換する', () => {
    const onObjectContextMenu = vi.fn();
    render(
      <ObjectList
        folders={[]}
        objects={[firstObject]}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onSelectionChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        onObjectContextMenu={onObjectContextMenu}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );
    const tile = screen.getByText(firstObject.name).closest('[data-kind="object"]');
    if (!(tile instanceof HTMLElement)) throw new Error('object tile was not rendered');
    vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue({ x: 40, y: 60, left: 40, top: 60, right: 208, bottom: 300, width: 168, height: 240, toJSON: () => ({}) });

    fireEvent.contextMenu(tile, { clientX: 100, clientY: 120 });

    expect(onObjectContextMenu).toHaveBeenCalledWith(firstObject, { x: 100, y: 120 }, tile);
  });

  it('folder では file context menu を開かない', () => {
    const onObjectContextMenu = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={[]}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onSelectionChange={vi.fn()}
        onDeleteRequest={vi.fn()}
        onObjectContextMenu={onObjectContextMenu}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );
    const tile = screen.getByText('docs').closest('[data-kind="folder"]');
    if (!(tile instanceof HTMLElement)) throw new Error('folder tile was not rendered');

    fireEvent.contextMenu(tile, { clientX: 100, clientY: 120 });

    expect(onObjectContextMenu).not.toHaveBeenCalled();
  });

  it('ArrowRight で隣のタイルへ移動して選択できる', async () => {
    const onSelectionChange = vi.fn();
    render(
      <ObjectList
        folders={[]}
        objects={objects}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={onSelectionChange}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight} ');

    expect([...getLastSelection(onSelectionChange)]).toEqual(['f:f1.txt']);
  });

  it('shift+ArrowRight で範囲選択が伸びる', async () => {
    const onSelectionChange = vi.fn();
    render(
      <ControlledObjectList
        folders={[]}
        objects={objects}
        getContentUrl={getContentUrl}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={onSelectionChange}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard(' {Shift>}{ArrowRight}{ArrowRight}{/Shift}');

    expect([...getLastSelection(onSelectionChange)]).toEqual(['f:f0.txt', 'f:f1.txt', 'f:f2.txt']);
  });

  it('ArrowDown で同じ列の次の行へ移動して選択できる', async () => {
    const onSelectionChange = vi.fn();
    render(
      <ObjectList
        folders={[]}
        objects={objects}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={onSelectionChange}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown} ');

    expect([...getLastSelection(onSelectionChange)]).toEqual(['f:f3.txt']);
  });

  it('platform の select-all shortcut で未 materialize の object も collection から全選択する', async () => {
    const manyObjects: readonly ObjectDescriptor[] = Array.from({ length: 30 }, (_, index) => ({
      bucketId: 'photos',
      key: `offscreen-${index}.txt`,
      name: `offscreen-${index}.txt`,
      contentType: 'text/plain',
      size: index,
      uploadedAt: '2026-08-14T00:00:00.000Z',
      etag: `offscreen-${index}`,
      media: NO_MEDIA,
    }));
    const onSelectionChange = vi.fn();
    render(
      <ObjectList
        folders={[]}
        objects={manyObjects}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={onSelectionChange}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );
    expect(document.querySelectorAll('[data-kind="object"]').length).toBeLessThan(manyObjects.length);

    await userEvent.tab();
    const selectAllShortcut = navigator.platform.toLowerCase().includes('mac') ? '{Meta>}a{/Meta}' : '{Control>}a{/Control}';
    await userEvent.keyboard(selectAllShortcut);

    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toBe('all');
  });

  it('フォルダを Enter で開ける', async () => {
    const onOpenFolder = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={[]}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={onOpenFolder}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onOpenFolder).toHaveBeenCalledWith('docs/');
  });

  it('フォルダとファイルを square preview 付きのタイルで描画する', () => {
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={[firstObject]}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    const folderTile = screen.getByText('docs').closest('[data-kind="folder"]');
    const fileTile = screen.getByText('f0.txt').closest('[data-kind="object"]');

    // f0.txt(text/plain)は Task 11 の textPlugin が拾うので doc glyph になる(opaque の blank ではない)。
    expect(folderTile?.querySelector('[data-preview-kind="folder"] svg[data-glyph="folder"]')).toBeTruthy();
    expect(fileTile?.querySelector('[data-preview-kind="icon"] svg[data-glyph="doc"]')).toBeTruthy();
  });

  it('長い名前と短い名前でも仮想化タイルの高さを 240px に揃える', () => {
    const longObject: ObjectDescriptor = { ...secondObject, name: 'スクリーンショット-とても長いファイル名-2026-08-14.txt' };
    render(
      <ObjectList
        folders={[]}
        objects={[firstObject, longObject]}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    const shortTile = screen.getByText('f0.txt').closest('[data-kind="object"]');
    const longTile = screen.getByText(longObject.name).closest('[data-kind="object"]');
    if (!(shortTile instanceof HTMLElement) || !(longTile instanceof HTMLElement)) throw new Error('object tile was not rendered');
    const shortLayout = shortTile.parentElement;
    const longLayout = longTile.parentElement;
    if (!(shortLayout instanceof HTMLElement) || !(longLayout instanceof HTMLElement)) throw new Error('virtualized tile layout was not rendered');

    expect(shortLayout.style.height).toBe('240px');
    expect(longLayout.style.height).toBe(shortLayout.style.height);
  });

  it('画像は content URL を遅延 decode の preview に使い、読込失敗時は icon に戻る', () => {
    render(
      <ObjectList
        folders={[]}
        objects={[image]}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    const preview = screen.getByText(image.name).closest('[data-kind="object"]')?.querySelector('img');
    if (!(preview instanceof HTMLImageElement)) throw new Error('image preview was not rendered');

    expect(preview.src).toBe('http://localhost:3000/api/buckets/photos/content/cover%20image.png');
    expect(preview.getAttribute('loading')).toBe('lazy');
    expect(preview.getAttribute('decoding')).toBe('async');

    fireEvent.error(preview);

    const imageTile = screen.getByText(image.name).closest('[data-kind="object"]');
    expect(imageTile?.querySelector('img')).toBeNull();
    expect(imageTile?.querySelector('[data-preview-kind="icon"] svg[data-glyph="image"]')).toBeTruthy();
  });

  it('同じ key の画像が新しい ETag と URL に更新されたら load error を解除して再試行する', () => {
    const { rerender } = render(
      <ObjectList
        folders={[]}
        objects={[image]}
        getContentUrl={getVersionedContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );
    const failedPreview = screen.getByText(image.name).closest('[data-kind="object"]')?.querySelector('img');
    if (!(failedPreview instanceof HTMLImageElement)) throw new Error('image preview was not rendered');
    fireEvent.error(failedPreview);

    const refreshedImage: ObjectDescriptor = { ...image, etag: 'cover-v2' };
    rerender(
      <ObjectList
        folders={[]}
        objects={[refreshedImage]}
        getContentUrl={getVersionedContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={noop}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    const refreshedPreview = screen.getByText(refreshedImage.name).closest('[data-kind="object"]')?.querySelector('img');
    if (!(refreshedPreview instanceof HTMLImageElement)) throw new Error('refreshed image preview was not rendered');
    expect(refreshedPreview.src).toBe('http://localhost:3000/api/buckets/photos/content/cover%20image.png?etag=cover-v2');
  });

  it('フォルダ行にホバーするとプリフェッチを頼む', async () => {
    const onPrefetchFolder = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={[]}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={onPrefetchFolder}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.hover(screen.getByText('docs'));

    expect(onPrefetchFolder).toHaveBeenCalledWith('docs/');
  });

  it('キーボードでフォルダ行にフォーカスしてもプリフェッチを頼む', async () => {
    const onPrefetchFolder = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={objects}
        getContentUrl={getContentUrl}
        selectedKeys={new Set()}
        onDeleteRequest={noop}
        onObjectContextMenu={noop}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={onPrefetchFolder}
        onExternalFiles={noop}
        onExternalFileError={noop}
        onOpenObject={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();

    expect(onPrefetchFolder).toHaveBeenCalledWith('docs/');
  });

  it('view 可能なファイル行のダブルクリックで onOpenObject が呼ばれる', async () => {
    const onOpenObject = vi.fn();
    renderObjectList({ objects: [make('a.png', 'image/png')], onOpenObject });
    const row = await screen.findByText('a.png');
    await userEvent.dblClick(row);
    expect(onOpenObject).toHaveBeenCalledWith('a.png');
  });

  it('opaque なファイル行のダブルクリックでは呼ばれない', async () => {
    const onOpenObject = vi.fn();
    renderObjectList({ objects: [make('a.bin', 'application/octet-stream')], onOpenObject });
    const row = await screen.findByText('a.bin');
    await userEvent.dblClick(row);
    expect(onOpenObject).not.toHaveBeenCalled();
  });
});
