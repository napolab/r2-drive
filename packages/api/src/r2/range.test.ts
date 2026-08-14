import { describe, expect, it } from 'vitest';

import { parseRangeHeader, resolveContentRange } from './range';

describe('parseRangeHeader', () => {
  it('ヘッダが無ければ whole', () => {
    expect(parseRangeHeader(null, 1000)).toEqual({ kind: 'whole' });
  });

  it('bytes=0-99 は window', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ kind: 'window', offset: 0, length: 100 });
  });

  it('bytes=500- は offset のみ', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ kind: 'offset', offset: 500 });
  });

  it('bytes=-200 は suffix', () => {
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ kind: 'suffix', suffix: 200 });
  });

  it('終端がサイズを超えても切り詰めて返す', () => {
    expect(parseRangeHeader('bytes=900-2000', 1000)).toEqual({ kind: 'window', offset: 900, length: 100 });
  });

  it('複数レンジは非対応 — unsatisfiable', () => {
    expect(parseRangeHeader('bytes=0-99,200-299', 1000)).toEqual({ kind: 'unsatisfiable' });
  });

  it('範囲外は unsatisfiable', () => {
    expect(parseRangeHeader('bytes=2000-3000', 1000)).toEqual({ kind: 'unsatisfiable' });
  });

  it('壊れたヘッダは whole として扱う', () => {
    expect(parseRangeHeader('garbage', 1000)).toEqual({ kind: 'whole' });
  });

  it('bytes=-0 は末尾 0 バイトなので unsatisfiable', () => {
    expect(parseRangeHeader('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
  });
});

describe('resolveContentRange', () => {
  it('whole は先頭から末尾までを指す', () => {
    expect(resolveContentRange({ kind: 'whole' }, 10)).toEqual({ start: 0, end: 9, length: 10, total: 10 });
  });

  it('window はそのまま start/end に写る', () => {
    expect(resolveContentRange({ kind: 'window', offset: 2, length: 3 }, 10)).toEqual({ start: 2, end: 4, length: 3, total: 10 });
  });

  it('offset は末尾までを指す', () => {
    expect(resolveContentRange({ kind: 'offset', offset: 7 }, 10)).toEqual({ start: 7, end: 9, length: 3, total: 10 });
  });

  it('suffix は末尾から N バイトを指す', () => {
    expect(resolveContentRange({ kind: 'suffix', suffix: 3 }, 10)).toEqual({ start: 7, end: 9, length: 3, total: 10 });
  });
});
