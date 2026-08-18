import { describe, expect, it } from 'vitest';

import { keyPartsOf } from './index';

describe('keyPartsOf', () => {
  it('ルート直下のキーは parentPrefix が空文字で祖先を持たない', () => {
    expect(keyPartsOf('report.pdf')).toEqual({ name: 'report.pdf', parentPrefix: '', ancestorPrefixes: [] });
  });

  it('1 階層下のキーは自分の親だけを祖先に持つ', () => {
    expect(keyPartsOf('photos/a.jpg')).toEqual({ name: 'a.jpg', parentPrefix: 'photos/', ancestorPrefixes: ['photos/'] });
  });

  it('深いキーは祖先を浅い順に列挙する', () => {
    expect(keyPartsOf('a/b/c/d.txt')).toEqual({
      name: 'd.txt',
      parentPrefix: 'a/b/c/',
      ancestorPrefixes: ['a/', 'a/b/', 'a/b/c/'],
    });
  });

  it('末尾が / のキー(フォルダマーカー)も name が空文字になるだけで壊れない', () => {
    expect(keyPartsOf('a/b/')).toEqual({ name: '', parentPrefix: 'a/b/', ancestorPrefixes: ['a/', 'a/b/'] });
  });

  it('連続するスラッシュを潰さない', () => {
    expect(keyPartsOf('a//b.txt')).toEqual({ name: 'b.txt', parentPrefix: 'a//', ancestorPrefixes: ['a/', 'a//'] });
  });
});
