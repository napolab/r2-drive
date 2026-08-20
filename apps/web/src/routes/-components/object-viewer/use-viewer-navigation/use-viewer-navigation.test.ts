import { describe, expect, it } from 'vitest';

import { findAdjacentViewable } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string): ObjectDescriptor => ({ bucketId: 'b', key, name: key, contentType, size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });

// a.png(view)→ b.bin(opaque)→ c.jpg(view)→ d.bin(opaque)
const objects = [make('a.png', 'image/png'), make('b.bin', 'application/octet-stream'), make('c.jpg', 'image/jpeg'), make('d.bin', 'application/octet-stream')];

describe('findAdjacentViewable', () => {
  it('次の view 可能ファイルへ(opaque をスキップ)', () => {
    expect(findAdjacentViewable(objects, 'a.png', 1)?.key).toBe('c.jpg');
  });

  it('前の view 可能ファイルへ(opaque をスキップ)', () => {
    expect(findAdjacentViewable(objects, 'c.jpg', -1)?.key).toBe('a.png');
  });

  it('末尾では undefined(次ページは取りに行かない)', () => {
    expect(findAdjacentViewable(objects, 'c.jpg', 1)).toBeUndefined();
  });

  it('先頭では undefined', () => {
    expect(findAdjacentViewable(objects, 'a.png', -1)).toBeUndefined();
  });

  it('current が一覧に無ければ undefined(deep link で未ロードのケース)', () => {
    expect(findAdjacentViewable(objects, 'zzz.png', 1)).toBeUndefined();
  });
});
