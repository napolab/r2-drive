import { ObjectNotFoundError, R2OperationError, UploadSessionError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { respondTo } from './registry';

describe('respondTo', () => {
  it('ObjectNotFoundError を 404 にする', () => {
    expect(respondTo(new ObjectNotFoundError('a.txt'))).toEqual({
      status: 404,
      body: { name: 'ObjectNotFoundError', message: 'a.txt' },
    });
  });

  it('UploadSessionError を 409 にし reason を載せる', () => {
    expect(respondTo(new UploadSessionError('part-too-small'))).toEqual({
      status: 409,
      body: { name: 'UploadSessionError', message: 'upload session failed: part-too-small', reason: 'part-too-small' },
    });
  });

  it('外側が勝つ — UploadSessionError に包まれた ObjectNotFoundError は 409', () => {
    const error = new UploadSessionError('aborted', { cause: new ObjectNotFoundError('a.txt') });

    expect(respondTo(error).status).toBe(409);
  });

  it('外側がマッチしなければ内側まで掘る', () => {
    const error = new R2OperationError('boom', { cause: new ObjectNotFoundError('a.txt') });

    expect(respondTo(error).status).toBe(404);
  });

  it('誰もマッチしなければ 500 で内部情報を漏らさない', () => {
    expect(respondTo(new R2OperationError('bucket=secret key=private.txt'))).toEqual({
      status: 500,
      body: { name: 'InternalError', message: 'internal error' },
    });
  });

  it('Error ではない値でも 500 を返す', () => {
    expect(respondTo('boom').status).toBe(500);
  });
});
