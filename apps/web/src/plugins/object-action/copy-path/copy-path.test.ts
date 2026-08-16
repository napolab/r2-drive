import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyPathAction } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';
import type { ActionDescriptor } from '../types';

const objects: readonly ObjectDescriptor[] = ['docs/a.txt', 'docs/b.txt'].map((key) => ({
  bucketId: 'photos',
  key,
  name: key.split('/').at(-1) ?? key,
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: key,
}));

const getDescriptor = (): ActionDescriptor =>
  copyPathAction.run({ actionId: 'copy-path', objects }).match(
    (descriptor) => descriptor,
    () => {
      throw new Error('copy path action did not match its own id');
    },
  );

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copyPathAction', () => {
  it('複数 key を選択順の改行区切りで clipboard に書く', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await getDescriptor().run(objects);

    expect(writeText).toHaveBeenCalledWith('docs/a.txt\ndocs/b.txt');
  });
});
