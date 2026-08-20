import { describe, expect, it } from 'vitest';

import { MediaLoadError } from './media-load-error';

describe('MediaLoadError', () => {
  it('name と message を保持する', () => {
    const error = new MediaLoadError('画像を読み込めませんでした');

    expect(error.name).toBe('MediaLoadError');
    expect(error.message).toBe('画像を読み込めませんでした');
    expect(error).toBeInstanceOf(Error);
  });

  it('cause を連鎖できる', () => {
    const cause = new Error('network error');
    const error = new MediaLoadError('再生ソースを解決できませんでした', { cause });

    expect(error.cause).toBe(cause);
  });
});
