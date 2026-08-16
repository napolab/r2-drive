import type { UppyFile } from '@uppy/core';
import type { UploadTrayItem } from '../../routes/-components/upload-tray/index';
import type { UploadBody, UploadMeta } from '../create-uploader/index';

const progressOf = (file: UppyFile<UploadMeta, UploadBody>): number => Math.min(100, Math.max(0, file.progress.percentage ?? 0));

const toUploadTrayItem = (file: UppyFile<UploadMeta, UploadBody>): UploadTrayItem => {
  const progress = progressOf(file);
  if (file.error !== undefined && file.error !== null && file.error !== '') return { id: file.id, name: file.name, progress, state: 'error', message: file.error };
  if (file.progress.uploadComplete === true) return { id: file.id, name: file.name, progress, state: 'complete' };
  if (file.progress.uploadStarted === null) return { id: file.id, name: file.name, progress, state: 'queued' };

  return { id: file.id, name: file.name, progress, state: 'uploading' };
};

export const toUploadTrayItems = (files: readonly UppyFile<UploadMeta, UploadBody>[]): readonly UploadTrayItem[] => files.map(toUploadTrayItem);
