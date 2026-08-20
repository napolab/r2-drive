import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GalleryView, isGalleryMedia } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

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
  const onOpenObject = vi.fn();
  const onExternalFiles = vi.fn();
  const onExternalFileError = vi.fn();
  const { container } = render(
    <GalleryView
      objects={[make('a.png', 'image/png', { kind: 'image', width: 800, height: 600 })]}
      getContentUrl={(o) => `/content/${o.key}`}
      selectedKeys={new Set()}
      onSelectionChange={() => undefined}
      onOpenObject={onOpenObject}
      onExternalFiles={onExternalFiles}
      onExternalFileError={onExternalFileError}
      onLoadMore={() => undefined}
      isLoadingMore={false}
      {...overrides}
    />,
  );
  return { container, onOpenObject, onExternalFiles, onExternalFileError };
};

describe('GalleryView', () => {
  it('画像・動画以外(フォルダ相当の非メディアファイル)はギャラリーに表示されない', () => {
    // GalleryView はそもそも folders / onOpenFolder を受け取らない(タイルビューの役割)。
    // 非メディアの objects も skyline から除外されることを cell 数で確認する。
    const { container } = renderGallery({ objects: [make('notes.md', 'text/markdown'), make('a.png', 'image/png', { kind: 'image', width: 800, height: 600 })] });
    expect(container.querySelectorAll('[role="row"]')).toHaveLength(1);
    expect(container.querySelector('img')).toBeTruthy();
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

  it('動画セルは <video> を preload=metadata / muted / playsInline / controls なしで描画する', () => {
    const { container } = renderGallery({ objects: [make('v.mp4', 'video/mp4')] });
    const video = container.querySelector('video') as HTMLVideoElement | null;
    if (video === null) throw new Error('video cell did not render a <video>');
    expect(video.getAttribute('src')).toBe('/content/v.mp4');
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('controls')).toBe(false);
  });

  it('動画セルをクリックすると onOpenObject が呼ばれる(再生はビューアの仕事)', async () => {
    const { container, onOpenObject } = renderGallery({ objects: [make('v.mp4', 'video/mp4')] });
    const video = container.querySelector('video');
    if (video === null) throw new Error('video cell did not render a <video>');
    await userEvent.click(video);
    expect(onOpenObject).toHaveBeenCalledWith('v.mp4');
  });

  // object-list の FileRow は getObjectRowId(`f:${key}`)を GridListItem の id に使う。
  // Task 9 で選択状態(bucket-object-actions)を object-list と gallery で共有する前提なので、
  // gallery のメディアセルも同じキー空間で選択される必要がある(でないと bulk actions や
  // folder ガードから gallery 経由の選択がすり抜ける)。
  it('メディアセルの選択は object-list と同じ getObjectRowId(`f:${key}`)形式のキーで通知される', async () => {
    const onSelectionChange = vi.fn();
    renderGallery({ objects: [make('a.png', 'image/png', { kind: 'image', width: 800, height: 600 })], onSelectionChange });

    await userEvent.tab();
    await userEvent.keyboard(' ');

    const selection: unknown = onSelectionChange.mock.calls.at(-1)?.[0];
    if (!(selection instanceof Set)) throw new Error('selection was not a Set');
    expect([...selection]).toEqual(['f:a.png']);
  });
});

describe('isGalleryMedia', () => {
  it('contentType image/* または video/* のみ true', () => {
    expect(isGalleryMedia(make('a.png', 'image/png'))).toBe(true);
    expect(isGalleryMedia(make('v.mp4', 'video/mp4'))).toBe(true);
    expect(isGalleryMedia(make('a.md', 'text/markdown'))).toBe(false);
    expect(isGalleryMedia(make('a.bin', 'application/octet-stream'))).toBe(false);
  });
});
