import { NO_MEDIA } from '@r2-drive/core';
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
  media: NO_MEDIA,
};

describe('markdownPlugin preview', () => {
  it('Markdown を document icon で描画する', () => {
    const { Preview } = markdownPlugin.run(object)._unsafeUnwrap();
    const { container } = render(<Preview object={object} getContentUrl={() => '/unused'} />);

    expect(container.querySelector('svg')?.dataset.glyph).toBe('doc');
  });
});

describe('markdownPlugin capability', () => {
  it('markdown は view capability を持つ', () => {
    const result = markdownPlugin.run({ bucketId: 'b', key: 'a.md', name: 'a.md', contentType: 'text/markdown', size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"', media: NO_MEDIA });
    expect(result.isOk() && result.value.capability.kind).toBe('view');
  });
});
