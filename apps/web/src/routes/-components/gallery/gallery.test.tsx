import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GalleryView, isGalleryImage } from './index';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string, media: ObjectDescriptor['media'] = { kind: 'none' }): ObjectDescriptor => ({
  bucketId: 'b',
  key,
  name: key,
  contentType,
  size: 1,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
  media,
});
const folder = (prefix: string): FolderDescriptor => ({ bucketId: 'b', prefix, name: prefix.slice(0, -1) });

// SkylineLayout は viewport 幅から列数を決める。jsdom の clientWidth/clientHeight は
// 常に 0 なので、実ブラウザ相当の scroll viewport をこの component test だけに与える
// (object-list.test.tsx と同じ手法)。
beforeEach(() => {
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

const renderGallery = (overrides: Partial<Parameters<typeof GalleryView>[0]> = {}) => {
  const onOpenFolder = vi.fn();
  const onOpenObject = vi.fn();
  const { container } = render(
    <GalleryView
      folders={[folder('trips/')]}
      objects={[make('a.png', 'image/png', { kind: 'image', width: 800, height: 600 }), make('b.png', 'image/png'), make('notes.md', 'text/markdown')]}
      getContentUrl={(o) => `/content/${o.key}`}
      selectedKeys={new Set()}
      onSelectionChange={() => undefined}
      onOpenFolder={onOpenFolder}
      onOpenObject={onOpenObject}
      onLoadMore={() => undefined}
      isLoadingMore={false}
      {...overrides}
    />,
  );
  return { container, onOpenFolder, onOpenObject };
};

describe('GalleryView', () => {
  it('フォルダと非画像はチップ列、画像はチップに出ない', () => {
    renderGallery();
    expect(screen.getByRole('button', { name: /trips/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /notes\.md/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /a\.png/ })).toBeNull();
  });

  it('フォルダチップで onOpenFolder が呼ばれる', async () => {
    const { onOpenFolder } = renderGallery();
    await userEvent.click(screen.getByRole('button', { name: /trips/ }));
    expect(onOpenFolder).toHaveBeenCalledWith('trips/');
  });

  it('view 可能な非画像チップで onOpenObject が呼ばれる', async () => {
    const { onOpenObject } = renderGallery();
    await userEvent.click(screen.getByRole('button', { name: /notes\.md/ }));
    expect(onOpenObject).toHaveBeenCalledWith('notes.md');
  });

  it('opaque な非画像チップは無効化され onOpenObject を呼ばない', async () => {
    const { onOpenObject } = renderGallery({ objects: [make('archive.bin', 'application/octet-stream')] });
    const chip = screen.getByRole('button', { name: /archive\.bin/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    await userEvent.click(chip);
    expect(onOpenObject).not.toHaveBeenCalled();
  });

  it('チップが 20 件を超えると畳まれ、「他 N 件」で展開できる', async () => {
    const manyFolders = Array.from({ length: 25 }, (_, i) => folder(`dir-${i}/`));
    renderGallery({ folders: manyFolders, objects: [] });

    expect(screen.getAllByRole('button', { name: /^dir-/ })).toHaveLength(20);
    const more = screen.getByRole('button', { name: /他 5 件/ });
    expect(more).toBeTruthy();

    await userEvent.click(more);
    expect(screen.getAllByRole('button', { name: /^dir-/ })).toHaveLength(25);
    expect(screen.queryByRole('button', { name: /他 \d+ 件/ })).toBeNull();
  });

  it('画像セルをクリックすると onOpenObject が呼ばれる', async () => {
    const { container, onOpenObject } = renderGallery({ objects: [make('a.png', 'image/png', { kind: 'image', width: 800, height: 600 })] });
    const img = container.querySelector('img');
    if (img === null) throw new Error('image cell did not render an <img>');
    await userEvent.click(img);
    expect(onOpenObject).toHaveBeenCalledWith('a.png');
  });

  it('media none の画像でも正方形セルとして描画が成立する', () => {
    const { container } = renderGallery({ objects: [make('b.png', 'image/png')] });
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/content/b.png');
  });

  // object-list の FileRow は getObjectRowId(`f:${key}`)を GridListItem の id に使う。
  // Task 9 で選択状態(bucket-object-actions)を object-list と gallery で共有する前提なので、
  // gallery の画像セルも同じキー空間で選択される必要がある(でないと bulk actions や
  // folder ガードから gallery 経由の選択がすり抜ける)。
  it('画像セルの選択は object-list と同じ getObjectRowId(`f:${key}`)形式のキーで通知される', async () => {
    const onSelectionChange = vi.fn();
    renderGallery({ folders: [], objects: [make('a.png', 'image/png', { kind: 'image', width: 800, height: 600 })], onSelectionChange });

    await userEvent.tab();
    await userEvent.keyboard(' ');

    const selection: unknown = onSelectionChange.mock.calls.at(-1)?.[0];
    if (!(selection instanceof Set)) throw new Error('selection was not a Set');
    expect([...selection]).toEqual(['f:a.png']);
  });
});

describe('isGalleryImage', () => {
  it('contentType image/* のみ true', () => {
    expect(isGalleryImage(make('a.png', 'image/png'))).toBe(true);
    expect(isGalleryImage(make('a.md', 'text/markdown'))).toBe(false);
    expect(isGalleryImage(make('v.mp4', 'video/mp4'))).toBe(false);
  });
});
