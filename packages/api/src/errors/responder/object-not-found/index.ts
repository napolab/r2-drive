import { ObjectNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const objectNotFoundResponder: ErrorResponder = {
  id: 'object-not-found',
  run: (error) => (error instanceof ObjectNotFoundError ? ok({ status: 404, body: { name: 'ObjectNotFoundError', message: error.message } }) : err(error)),
};
