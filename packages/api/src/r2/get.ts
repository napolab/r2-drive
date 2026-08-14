import { ObjectNotFoundError, R2OperationError } from '@r2-drive/core';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import type { R2RangeSpec } from './range';
import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

const toR2Range = (spec: R2RangeSpec): R2Range | undefined => {
  switch (spec.kind) {
    case 'whole':
      return undefined;
    case 'offset':
      return { offset: spec.offset };
    case 'window':
      return { offset: spec.offset, length: spec.length };
    case 'suffix':
      return { suffix: spec.suffix };
    case 'unsatisfiable':
      return undefined;
    default: {
      const _exhaustive: never = spec;
      throw new Error(`unhandled range spec: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// exactOptionalPropertyTypes: true 下では `{ range: undefined }` を渡せないため、
// range が無いときはキー自体を省く。
const toGetOptions = (spec: R2RangeSpec): R2GetOptions => {
  const range = toR2Range(spec);

  return range === undefined ? {} : { range };
};

export const getObject = (bucket: R2Bucket, key: string, spec: R2RangeSpec): ResultAsync<R2ObjectBody, DriveError> =>
  fromPromise(bucket.get(key, toGetOptions(spec)), (cause) => new R2OperationError(`get failed: ${key}`, { cause })).andThen((object) =>
    object === null ? errAsync(new ObjectNotFoundError(key)) : okAsync(object),
  );
