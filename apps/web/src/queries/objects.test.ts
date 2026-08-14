import { describe, expect, it } from 'vitest';

import { toPrefix } from './objects';

describe('toPrefix', () => {
  it('ルートは空文字のまま', () => {
    expect(toPrefix(undefined)).toBe('');
    expect(toPrefix('')).toBe('');
  });

  // TanStack Router の splat は末尾の '/' を落とす。R2 の共通接頭辞として使うには戻す。
  it('末尾に / が無い splat には足す', () => {
    expect(toPrefix('trips')).toBe('trips/');
    expect(toPrefix('trips/2026')).toBe('trips/2026/');
  });

  it('既に / で終わっていれば二重にしない', () => {
    expect(toPrefix('trips/')).toBe('trips/');
  });
});
