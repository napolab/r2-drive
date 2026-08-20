import { NO_MEDIA, ObjectNotFoundError, R2OperationError } from '@r2-drive/core';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import { keyPartsOf } from '../object-index/key-parts/index';
import { contentTypeOf } from './list';

import type { DriveError, ObjectDescriptor } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

export const headObject = (bucket: R2Bucket, bucketId: string, key: string): ResultAsync<ObjectDescriptor, DriveError> =>
  fromPromise(bucket.head(key), (cause) => new R2OperationError(`head failed: ${key}`, { cause })).andThen((head) =>
    head === null
      ? errAsync(new ObjectNotFoundError(key))
      : okAsync({
          bucketId,
          key,
          name: keyPartsOf(key).name,
          contentType: contentTypeOf(key),
          size: head.size,
          uploadedAt: head.uploaded.toISOString(),
          etag: head.httpEtag,
          // R2 は寸法を知らない。索引列からの導出は Task 2。
          media: NO_MEDIA,
        }),
  );
