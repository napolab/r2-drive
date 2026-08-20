import { describe, expect, it } from 'vitest';

import { highlightCode, isHighlightLanguage, PRELOADED_LANGUAGE_KEYS } from './index';

describe('highlight', () => {
  it('既知の言語はトークン別の CSS 変数で色付く', async () => {
    const html = await highlightCode('const a = 1;', 'typescript');
    expect(html).toContain('var(--shiki-');
    expect(html).toContain('<pre');
  });

  it('未知の言語は plain(text)として描画される', async () => {
    const html = await highlightCode('hello', 'not-a-language');
    expect(html).toContain('<pre');
    expect(html).toContain('hello');
  });

  it('コード内の HTML はエスケープされる(XSS)', async () => {
    const html = await highlightCode('<script>alert(1)</script>', 'not-a-language');
    expect(html).not.toContain('<script>');
  });

  it('isHighlightLanguage は PRELOADED_LANGUAGE_KEYS と 1:1', () => {
    for (const key of PRELOADED_LANGUAGE_KEYS) {
      expect(isHighlightLanguage(key)).toBe(true);
    }
    expect(isHighlightLanguage('cobol')).toBe(false);
  });
});
