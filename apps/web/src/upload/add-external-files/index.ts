import { RestrictionError } from '@uppy/core';

import type { R2Uploader } from '../create-uploader/index';

type AddExternalFilesInput = { readonly uppy: R2Uploader; readonly files: readonly File[] };

class ExternalFileAddError extends Error {
  override name = 'ExternalFileAddError';
}

const toError = (cause: unknown): Error => (cause instanceof Error ? cause : new ExternalFileAddError('ファイルを追加できませんでした', { cause }));

// Uppy は restriction error を store.info に積んでから throw する。event handler の
// 外へ rejection を漏らさず、想定外の cause も同じ可視チャンネルへ正規化する。
export const addExternalFiles = ({ uppy, files }: AddExternalFilesInput): void => {
  for (const file of files) {
    try {
      uppy.addFile(file);
    } catch (cause) {
      if (cause instanceof RestrictionError) continue;
      const error = toError(cause);
      uppy.info(error.message, 'error');
    }
  }
};
