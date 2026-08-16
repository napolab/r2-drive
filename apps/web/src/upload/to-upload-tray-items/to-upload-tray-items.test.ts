import Uppy from '@uppy/core';
import { describe, expect, it } from 'vitest';

import { toUploadTrayItems } from './index';

import type { UploadBody, UploadMeta } from '../create-uploader/index';

describe('toUploadTrayItems', () => {
  it('Uppy store の queued/uploading/error/complete を optional の無い UI union に正規化する', () => {
    const uppy = new Uppy<UploadMeta, UploadBody>({ meta: { prefix: '' } });
    const queued = uppy.addFile(new File(['q'], 'queued.bin'));
    const uploading = uppy.addFile(new File(['uploading'], 'uploading.bin'));
    const error = uppy.addFile(new File(['error'], 'error.bin'));
    const complete = uppy.addFile(new File(['complete'], 'complete.bin'));
    uppy.setFileState(uploading, { progress: { uploadStarted: 1, bytesUploaded: 4, bytesTotal: 10, percentage: 40, uploadComplete: false } });
    uppy.setFileState(error, { error: 'network failed', progress: { uploadStarted: 1, bytesUploaded: 6, bytesTotal: 10, percentage: 60, uploadComplete: false } });
    uppy.setFileState(complete, { progress: { uploadStarted: 1, bytesUploaded: 10, bytesTotal: 10, percentage: 100, uploadComplete: true, complete: true } });

    expect(toUploadTrayItems(uppy.getFiles())).toEqual([
      { id: queued, name: 'queued.bin', progress: 0, state: 'queued' },
      { id: uploading, name: 'uploading.bin', progress: 40, state: 'uploading' },
      { id: error, name: 'error.bin', progress: 60, state: 'error', message: 'network failed' },
      { id: complete, name: 'complete.bin', progress: 100, state: 'complete' },
    ]);
    uppy.destroy();
  });
});
