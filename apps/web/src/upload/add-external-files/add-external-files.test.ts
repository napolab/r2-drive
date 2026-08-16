import Uppy from '@uppy/core';
import { describe, expect, it } from 'vitest';

import { addExternalFiles } from './index';

import type { UploadBody, UploadMeta } from '../create-uploader/index';

describe('addExternalFiles', () => {
  it('同じ File を再追加しても event handler へ throw せず restriction error を store に残す', () => {
    const uppy = new Uppy<UploadMeta, UploadBody>({ meta: { prefix: '' } });
    const file = new File(['same'], 'same.txt', { type: 'text/plain' });

    addExternalFiles({ uppy, files: [file] });
    expect(() => addExternalFiles({ uppy, files: [file] })).not.toThrow();

    expect(uppy.getFiles()).toHaveLength(1);
    const errorMessages = uppy
      .getState()
      .info.filter((info) => info.type === 'error')
      .map((info) => info.message);
    expect(errorMessages).toHaveLength(1);
    expect(errorMessages[0]).toContain('same.txt');
    uppy.destroy();
  });

  it('想定外の add error は store に一度だけ可視化する', () => {
    const uppy = new Uppy<UploadMeta, UploadBody>({
      meta: { prefix: '' },
      onBeforeFileAdded: () => {
        throw new Error('unexpected add failure');
      },
    });

    expect(() => addExternalFiles({ uppy, files: [new File(['payload'], 'broken.txt')] })).not.toThrow();

    const errorMessages = uppy
      .getState()
      .info.filter((info) => info.type === 'error')
      .map((info) => info.message);
    expect(errorMessages).toEqual(['unexpected add failure']);
    uppy.destroy();
  });
});
