import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { imagePlugin } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

afterEach(cleanup);

const object: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'cover image.png',
  name: 'cover image.png',
  contentType: 'image/png',
  size: 128,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'cover',
};

const getContentUrl = () => '/api/buckets/photos/content/cover%20image.png';

describe('imagePlugin preview', () => {
  it('content URL を lazy/async の img に渡す', () => {
    const { Preview } = imagePlugin.run(object)._unsafeUnwrap();
    const { container } = render(<Preview object={object} getContentUrl={getContentUrl} />);
    const image = container.querySelector('img');
    if (!(image instanceof HTMLImageElement)) throw new Error('image preview was not rendered');

    expect(image.src).toBe('http://localhost:3000/api/buckets/photos/content/cover%20image.png');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.alt).toBe('');
  });

  it('img の読込に失敗すると画像 file icon に戻る', () => {
    const { Preview } = imagePlugin.run(object)._unsafeUnwrap();
    const { container } = render(<Preview object={object} getContentUrl={getContentUrl} />);
    const image = container.querySelector('img');
    if (!(image instanceof HTMLImageElement)) throw new Error('image preview was not rendered');

    fireEvent.error(image);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')?.dataset.glyph).toBe('image');
  });
});
