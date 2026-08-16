import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { ObjectList } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const noop = () => undefined;
const getContentUrl = (object: ObjectDescriptor) => `/api/buckets/${object.bucketId}/content/${object.key}`;

const objects: readonly ObjectDescriptor[] = [
  {
    bucketId: 'photos',
    key: 'short.txt',
    name: '短い.txt',
    contentType: 'text/plain',
    size: 10,
    uploadedAt: '2026-08-14T00:00:00.000Z',
    etag: 'short',
  },
  {
    bucketId: 'photos',
    key: 'long.txt',
    name: 'スクリーンショット-とても長いファイル名-2026-08-14.txt',
    contentType: 'text/plain',
    size: 20,
    uploadedAt: '2026-08-14T00:00:00.000Z',
    etag: 'long',
  },
];

type TileParts = {
  readonly tile: HTMLElement;
  readonly grid: HTMLElement;
  readonly preview: HTMLElement;
  readonly name: HTMLElement;
  readonly meta: HTMLElement;
};

const getTileParts = (tile: Element): TileParts => {
  // react-aria が role=gridcell の display:contents wrapper を 1 枚挿入する。
  const grid = tile.firstElementChild?.firstElementChild;
  const preview = grid?.children[0];
  const name = grid?.children[1];
  const meta = grid?.children[2];
  if (!(tile instanceof HTMLElement) || !(grid instanceof HTMLElement) || !(preview instanceof HTMLElement) || !(name instanceof HTMLElement) || !(meta instanceof HTMLElement)) {
    throw new Error('tile の preview / name / meta track が描画されなかった');
  }
  return { tile, grid, preview, name, meta };
};

const getTrackOffsets = ({ tile, preview, name, meta }: TileParts): readonly (readonly [number, number])[] => {
  const tileRect = tile.getBoundingClientRect();
  return [preview, name, meta].map((track) => {
    const rect = track.getBoundingClientRect();
    return [rect.top - tileRect.top, rect.bottom - tileRect.top] as const;
  });
};

it('実 CSS で preview が正方形になり、長短の名前が同じ subgrid track を使う', async () => {
  const host = document.createElement('div');
  host.style.width = '600px';
  host.style.height = '600px';
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    flushSync(() => {
      root.render(
        <ObjectList
          folders={[]}
          objects={objects}
          getContentUrl={getContentUrl}
          selectedKeys={new Set()}
          onSelectionChange={noop}
          onDeleteRequest={noop}
          onObjectContextMenu={noop}
          onOpenFolder={noop}
          onPrefetchFolder={noop}
          onExternalFiles={noop}
          onExternalFileError={noop}
          onLoadMore={noop}
          isLoadingMore={false}
        />,
      );
    });

    await expect.poll(() => host.querySelectorAll('[data-kind="object"]').length).toBe(2);
    const tiles = [...host.querySelectorAll('[data-kind="object"]')].map(getTileParts);
    const shortTile = tiles[0];
    const longTile = tiles[1];
    if (shortTile === undefined || longTile === undefined) throw new Error('比較する object tile が描画されなかった');

    const shortTileRect = shortTile.tile.getBoundingClientRect();
    const longTileRect = longTile.tile.getBoundingClientRect();
    const gridRect = shortTile.grid.getBoundingClientRect();
    const previewRect = shortTile.preview.getBoundingClientRect();

    expect(shortTileRect.height).toBeCloseTo(longTileRect.height);
    expect(previewRect.width).toBeCloseTo(gridRect.width);
    expect(previewRect.width).toBeCloseTo(previewRect.height);
    expect(getTrackOffsets(shortTile)).toEqual(getTrackOffsets(longTile));
    expect(getComputedStyle(shortTile.grid).gridTemplateRows).toMatch(/^subgrid/);
    expect(getComputedStyle(longTile.grid).gridTemplateRows).toMatch(/^subgrid/);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
