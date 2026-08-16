import { BucketNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const bucketNotFoundResponder: ErrorResponder = {
  id: 'bucket-not-found',
  run: (error) => (error instanceof BucketNotFoundError ? ok({ status: 404, body: { name: 'BucketNotFoundError', message: error.message } }) : err(error)),
};
