import { ObjectNotFoundError, R2OperationError, UploadSessionError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { ForeignCursorError } from '../../object-index/errors';

import { respondTo } from './registry';

// DO の RPC 境界を越えた後の姿。class は失われ Error になるが name / message は残る
// (実測。foreign-cursor/index.ts のコメント参照)。responder が instanceof ではなく
// name で判別できていることをここで固定する。
const asRpcTunneled = (error: Error): Error => Object.assign(new Error(error.message), { name: error.name });

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

  // wire に出る名前は既存の PreconditionFailedError に載せる(packages/core の
  // ErrorName を増やさないため。foreign-cursor/index.ts のコメント参照)。
  it('ForeignCursorError を 412 / PreconditionFailedError にする', () => {
    expect(respondTo(new ForeignCursorError('object index list'))).toEqual({
      status: 412,
      body: { name: 'PreconditionFailedError', message: 'cursor does not belong to the object index list route' },
    });
  });

  it('RPC 境界を越えて class が失われた ForeignCursorError も 412 にする', () => {
    const tunneled = asRpcTunneled(new ForeignCursorError('object index list'));
    expect(tunneled).not.toBeInstanceOf(ForeignCursorError);

    expect(respondTo(tunneled).status).toBe(412);
  });

  it('R2OperationError に包まれた ForeignCursorError も 412 にする(索引経路の実際の形)', () => {
    const error = new R2OperationError('index list failed: a/', { cause: asRpcTunneled(new ForeignCursorError('object index list')) });

    expect(respondTo(error).status).toBe(412);
  });
});
