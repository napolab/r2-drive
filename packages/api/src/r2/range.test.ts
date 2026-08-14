import { describe, expect, it } from 'vitest';

import { parseRangeHeader } from './range';

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
});
