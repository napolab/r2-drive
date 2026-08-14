import { UploadSessionError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const uploadSessionResponder: ErrorResponder = {
  id: 'upload-session',
  run: (error) => (error instanceof UploadSessionError ? ok({ status: 409, body: { name: 'UploadSessionError', message: error.message, reason: error.reason } }) : err(error)),
};
