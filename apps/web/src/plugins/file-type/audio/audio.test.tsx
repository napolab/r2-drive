import { NO_MEDIA } from '@r2-drive/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { audioPlugin } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

afterEach(cleanup);

const object: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'track.flac',
  name: 'track.flac',
  contentType: 'audio/flac',
  size: 1,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'audio',
  media: NO_MEDIA,
};

describe('audioPlugin preview', () => {
  it('音声を audio icon で描画する', () => {
    const { Preview } = audioPlugin.run(object)._unsafeUnwrap();
    const { container } = render(<Preview object={object} getContentUrl={() => '/unused'} />);

    expect(container.querySelector('svg')?.dataset.glyph).toBe('audio');
  });
});

describe('audioPlugin capability', () => {
  it('audio は view capability を持つ', () => {
    const result = audioPlugin.run(object);
    expect(result.isOk() && result.value.capability.kind).toBe('view');
  });
});
