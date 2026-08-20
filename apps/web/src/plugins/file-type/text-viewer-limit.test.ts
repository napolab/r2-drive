import { describe, expect, it } from 'vitest';

import { admitTextViewer, MAX_TEXT_VIEWER_BYTES } from './text-viewer-limit';

describe('admitTextViewer', () => {
  it('ちょうど 1 MiB は ok', () => {
    expect(admitTextViewer(MAX_TEXT_VIEWER_BYTES)).toEqual({ kind: 'ok' });
  });

  it('1 バイト超過で too-large', () => {
    expect(admitTextViewer(MAX_TEXT_VIEWER_BYTES + 1)).toEqual({ kind: 'too-large', size: MAX_TEXT_VIEWER_BYTES + 1 });
  });
});
