import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { videoPlugin } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

afterEach(cleanup);

const object: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'clip.mp4',
  name: 'clip.mp4',
  contentType: 'video/mp4',
  size: 1,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'video',
};

describe('videoPlugin preview', () => {
  it('動画を video icon で描画する', () => {
    const { Preview } = videoPlugin.run(object)._unsafeUnwrap();
    const { container } = render(<Preview object={object} getContentUrl={() => '/unused'} />);

    expect(container.querySelector('svg')?.dataset.glyph).toBe('video');
  });
});

describe('videoPlugin capability', () => {
  it('video は view capability を持つ', () => {
    const result = videoPlugin.run(object);
    expect(result.isOk() && result.value.capability.kind).toBe('view');
  });
});
