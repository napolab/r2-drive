import { describe, expect, it } from 'vitest';

import { mediaOf, NO_MEDIA } from './object-descriptor';

describe('mediaOf', () => {
  it('width と height が揃っていれば image variant', () => {
    expect(mediaOf(800, 600)).toEqual({ kind: 'image', width: 800, height: 600 });
  });

  it('どちらかが欠けていれば none', () => {
    expect(mediaOf(null, null)).toEqual(NO_MEDIA);
    expect(mediaOf(800, null)).toEqual(NO_MEDIA);
    expect(mediaOf(undefined, 600)).toEqual(NO_MEDIA);
  });

  it('0 以下は none(壊れた抽出値を variant に昇格させない)', () => {
    expect(mediaOf(0, 600)).toEqual(NO_MEDIA);
    expect(mediaOf(800, -1)).toEqual(NO_MEDIA);
  });
});
