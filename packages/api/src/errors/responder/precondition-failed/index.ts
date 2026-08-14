import { PreconditionFailedError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const preconditionFailedResponder: ErrorResponder = {
  id: 'precondition-failed',
  run: (error) => (error instanceof PreconditionFailedError ? ok({ status: 412, body: { name: 'PreconditionFailedError', message: error.message } }) : err(error)),
};
