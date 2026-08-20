import { describe, expect, it } from 'vitest';

import { isGalleryMedia } from './index';
import { resolveViewMode } from './resolve-view-mode';

import type { ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string): ObjectDescriptor => ({
  bucketId: 'b',
  key,
  name: key,
  contentType,
  size: 1,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
  media: { kind: 'none' },
});

describe('resolveViewMode', () => {
  it('無指定 + 画像/動画ありはギャラリー', () => {
    expect(resolveViewMode(undefined, true)).toBe('gallery');
  });

  it('?mode=tiles は常にタイル', () => {
    expect(resolveViewMode('tiles', true)).toBe('tiles');
  });

  it('画像・動画 0 件は自動でタイル', () => {
    expect(resolveViewMode(undefined, false)).toBe('tiles');
  });

  // 動画は索引に寸法を持たない(mediaFactsHook が image/* しか probe しない)が、
  // isGalleryMedia は video/* も true を返す。画像が 1 枚も無く動画だけのフォルダでも
  // ギャラリーが既定表示になることを、route が実際に使う組み立て(objects.some(isGalleryMedia))
  // ごと確認する。
  it('動画だけのフォルダ(画像 0 件)でもギャラリーになる', () => {
    const objects = [make('a.mp4', 'video/mp4'), make('b.mov', 'video/quicktime')];
    expect(resolveViewMode(undefined, objects.some(isGalleryMedia))).toBe('gallery');
  });

  it('画像も動画も無いフォルダはタイル', () => {
    const objects = [make('notes.md', 'text/markdown')];
    expect(resolveViewMode(undefined, objects.some(isGalleryMedia))).toBe('tiles');
  });
});
