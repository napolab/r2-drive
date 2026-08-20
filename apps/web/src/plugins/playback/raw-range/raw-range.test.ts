import { NO_MEDIA } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { rawRangeResolver } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const object: ObjectDescriptor = {
  bucketId: 'b',
  key: 'v.mp4',
  name: 'v.mp4',
  contentType: 'video/mp4',
  size: 10,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
  media: NO_MEDIA,
};

describe('rawRangeResolver', () => {
  it('常に ok で content URL を返す', () => {
    const result = rawRangeResolver.run({ object, getContentUrl: (o) => `/content/${o.key}` });
    expect(result.isOk() && result.value).toEqual({ kind: 'raw', src: '/content/v.mp4' });
  });
});
