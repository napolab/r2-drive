import { R2OperationError } from '@r2-drive/core';
import { fromPromise } from 'neverthrow';

import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

export const deleteObject = (bucket: R2Bucket, key: string): ResultAsync<readonly string[], DriveError> =>
  fromPromise(bucket.delete(key), (cause) => new R2OperationError(`delete failed: ${key}`, { cause })).map(() => [key]);
