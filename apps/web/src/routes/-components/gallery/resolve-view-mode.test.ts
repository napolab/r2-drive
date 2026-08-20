import { describe, expect, it } from 'vitest';

import { resolveViewMode } from './resolve-view-mode';

describe('resolveViewMode', () => {
  it('無指定 + 画像ありはギャラリー', () => {
    expect(resolveViewMode(undefined, true)).toBe('gallery');
  });

  it('?mode=tiles は常にタイル', () => {
    expect(resolveViewMode('tiles', true)).toBe('tiles');
  });

  it('画像 0 件は自動でタイル', () => {
    expect(resolveViewMode(undefined, false)).toBe('tiles');
  });
});
