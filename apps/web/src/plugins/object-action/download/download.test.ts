import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadAction } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';
import type { ActionDescriptor } from '../types';

const object: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'docs/readme file.txt',
  name: 'readme file.txt',
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'readme',
};

const getDescriptor = (): ActionDescriptor =>
  downloadAction.run({ actionId: 'download', objects: [object] }).match(
    (descriptor) => descriptor,
    () => {
      throw new Error('download action did not match its own id');
    },
  );

afterEach(() => vi.restoreAllMocks());

describe('downloadAction', () => {
  it('typed content URL と filename を接続済み anchor に渡し、click 後に片付ける', async () => {
    const clicks: { readonly href: string; readonly download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      clicks.push({ href: this.href, download: this.download });
    });

    await getDescriptor().run([object]);

    expect(clicks).toEqual([{ href: 'http://localhost:3000/api/buckets/photos/content/docs/readme%20file.txt?v=readme', download: 'readme file.txt' }]);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
