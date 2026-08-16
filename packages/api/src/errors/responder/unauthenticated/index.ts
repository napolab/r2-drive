import { UnauthenticatedError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const unauthenticatedResponder: ErrorResponder = {
  id: 'unauthenticated',
  run: (error) => (error instanceof UnauthenticatedError ? ok({ status: 401, body: { name: 'UnauthenticatedError', message: error.message } }) : err(error)),
};
