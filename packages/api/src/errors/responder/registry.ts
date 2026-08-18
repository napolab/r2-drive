import { createRunner } from '@r2-drive/core';

import { bucketNotFoundResponder } from './bucket-not-found/index';
import { foreignCursorResponder } from './foreign-cursor/index';
import { objectNotFoundResponder } from './object-not-found/index';
import { preconditionFailedResponder } from './precondition-failed/index';
import { unauthenticatedResponder } from './unauthenticated/index';
import { uploadSessionResponder } from './upload-session/index';

import type { ErrorResponder } from './types';
import type { ResponseSpec } from '@r2-drive/core';

// 順序に意味がある(specific → broad)。
export const errorResponders = [
  objectNotFoundResponder,
  bucketNotFoundResponder,
  unauthenticatedResponder,
  preconditionFailedResponder,
  uploadSessionResponder,
  foreignCursorResponder,
] as const satisfies readonly ErrorResponder[];

const resolveResponse = createRunner(errorResponders);

const INTERNAL_ERROR = { status: 500, body: { name: 'InternalError', message: 'internal error' } } satisfies ResponseSpec;

// cause チェーンを外側から 1 回だけ歩き、最初にマッチしたリンクで確定する。
// 優先順位はチェーンの外側優先。意味を変えるときだけ包むこと。
export const respondTo = (value: unknown, depth = 32): ResponseSpec => {
  if (!(value instanceof Error) || depth <= 0) return INTERNAL_ERROR;

  return resolveResponse(value).match(
    (spec) => spec,
    () => respondTo(value.cause, depth - 1),
  );
};
