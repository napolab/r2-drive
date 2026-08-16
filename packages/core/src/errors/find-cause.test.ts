import { describe, expect, it } from 'vitest';

import { ObjectNotFoundError, R2OperationError, UploadSessionError } from './index';
import { describeCauseChain, findCause, isInstanceOf } from './find-cause';

describe('findCause', () => {
  it('先頭が一致すればそれを返す', () => {
    const error = new ObjectNotFoundError('a.txt');

    expect(findCause(error, isInstanceOf(ObjectNotFoundError))).toBe(error);
  });

  it('cause チェーンの奥にあるものを見つける', () => {
    const root = new ObjectNotFoundError('a.txt');
    const wrapped = new UploadSessionError('aborted', { cause: new R2OperationError('boom', { cause: root }) });

    expect(findCause(wrapped, isInstanceOf(ObjectNotFoundError))).toBe(root);
  });

  it('一致するものが無ければ undefined', () => {
    const error = new R2OperationError('boom');

    expect(findCause(error, isInstanceOf(ObjectNotFoundError))).toBeUndefined();
  });

  it('Error ではない値で止まる', () => {
    const error = new R2OperationError('boom', { cause: 'not an error' });

    expect(findCause(error, isInstanceOf(ObjectNotFoundError))).toBeUndefined();
  });

  it('depth 上限で打ち切る', () => {
    const deep = Array.from({ length: 40 }).reduce<Error>((acc) => new R2OperationError('wrap', { cause: acc }), new ObjectNotFoundError('a.txt'));

    expect(findCause(deep, isInstanceOf(ObjectNotFoundError), 5)).toBeUndefined();
  });

  it('一致した時点で止まる — 奥まで歩かない', () => {
    const inner = new ObjectNotFoundError('inner');
    const outer = new ObjectNotFoundError('outer', { cause: inner });

    expect(findCause(outer, isInstanceOf(ObjectNotFoundError))).toBe(outer);
  });
});

describe('describeCauseChain', () => {
  it('チェーンを根まで平坦化する', () => {
    const error = new UploadSessionError('aborted', { cause: new ObjectNotFoundError('a.txt') });

    expect(describeCauseChain(error)).toEqual(['UploadSessionError: upload session failed: aborted', 'ObjectNotFoundError: a.txt', 'undefined']);
  });
});
