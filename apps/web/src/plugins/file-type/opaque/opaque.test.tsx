import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { opaquePlugin } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

afterEach(cleanup);

const object: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'archive.bin',
  name: 'archive.bin',
  contentType: 'application/octet-stream',
  size: 1,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'opaque',
};

describe('opaquePlugin preview', () => {
  it('未知ファイルを blank icon で描画する', () => {
    const { Preview } = opaquePlugin.run(object)._unsafeUnwrap();
    const { container } = render(<Preview object={object} getContentUrl={() => '/unused'} />);

    expect(container.querySelector('svg')?.dataset.glyph).toBe('blank');
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('72');
  });

  it('opaque は opaque capability を持つ', () => {
    const result = opaquePlugin.run(object);
    expect(result.isOk() && result.value.capability.kind).toBe('opaque');
  });
});
