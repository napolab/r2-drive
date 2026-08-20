import { describe, expect, it } from 'vitest';

import { highlightCode, isHighlightLanguage, LANGUAGE_ALIASES, PRELOADED_LANGUAGE_KEYS } from './index';

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

  it('markdown コードフェンスの略記 "ts" はハイライトされる', async () => {
    const html = await highlightCode('const a = 1;', 'ts');
    // plain(text)フォールバックは pre の fg/bg 変数しか持たない。トークン別の
    // var(--shiki-token-*) が出ることが「実際に typescript として解決された」証拠になる。
    expect(html).toContain('var(--shiki-token-keyword)');
    expect(html).toContain('<pre');
  });

  it('markdown コードフェンスの略記 "js" はハイライトされる', async () => {
    const html = await highlightCode('const a = 1;', 'js');
    expect(html).toContain('var(--shiki-token-keyword)');
    expect(html).toContain('<pre');
  });

  it('LANGUAGE_ALIASES に無い略記は plain(text)にフォールバックする', async () => {
    const html = await highlightCode('print(1)', 'py');
    expect(html).toContain('<pre');
    expect(html).toContain('print(1)');
  });

  it('LANGUAGE_ALIASES の値はすべて PRELOADED_LANGUAGE_KEYS に含まれる', () => {
    for (const language of Object.values(LANGUAGE_ALIASES)) {
      expect(PRELOADED_LANGUAGE_KEYS).toContain(language);
    }
  });
});
