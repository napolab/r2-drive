import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { markdownPlugin } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

afterEach(cleanup);

const object: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'readme.md',
  name: 'readme.md',
  contentType: 'text/markdown',
  size: 1,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'markdown',
};

describe('markdownPlugin preview', () => {
  it('Markdown を document icon で描画する', () => {
    const { Preview } = markdownPlugin.run(object)._unsafeUnwrap();
    const { container } = render(<Preview object={object} getContentUrl={() => '/unused'} />);

    expect(container.querySelector('svg')?.dataset.glyph).toBe('doc');
  });
});
