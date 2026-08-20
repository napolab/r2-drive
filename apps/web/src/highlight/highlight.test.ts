import { describe, expect, it } from 'vitest';

import { highlightCode, isHighlightLanguage, LANGUAGE_ALIASES, PRELOADED_LANGUAGE_KEYS } from './index';

import type { Root } from 'hast';

// hast tree 内に指定した色の inline style を持つ span があるかを再帰的に調べる。
// shiki の codeToHast は style 属性を properties.style に文字列で持つ。
const containsTokenColor = (root: Root, color: string): boolean => {
  const stack: Root['children'] = [...root.children];
  for (const node of stack) {
    if (node.type === 'element') {
      const style = node.properties.style;
      if (typeof style === 'string' && style.includes(color)) return true;
      stack.push(...node.children);
    }
  }

  return false;
};

describe('highlight', () => {
  it('既知の言語はトークン別の CSS 変数で色付く', async () => {
    const result = await highlightCode('const a = 1;', 'typescript');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(containsTokenColor(result.value, 'var(--code-keyword)')).toBe(true);
  });

  it('未知の言語は plain(text)として描画される', async () => {
    const result = await highlightCode('hello', 'not-a-language');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(containsTokenColor(result.value, 'var(--code-keyword)')).toBe(false);
  });

  it('コード内の HTML はエスケープされる(XSS)', async () => {
    const result = await highlightCode('<script>alert(1)</script>', 'not-a-language');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    // hast のテキストノードはデータであり、<script> 要素としては現れない。
    const hasScriptElement = result.value.children.some((node) => node.type === 'element' && node.tagName === 'script');
    expect(hasScriptElement).toBe(false);
  });

  it('isHighlightLanguage は PRELOADED_LANGUAGE_KEYS と 1:1', () => {
    for (const key of PRELOADED_LANGUAGE_KEYS) {
      expect(isHighlightLanguage(key)).toBe(true);
    }
    expect(isHighlightLanguage('cobol')).toBe(false);
  });

  it('markdown コードフェンスの略記 "ts" はハイライトされる', async () => {
    const result = await highlightCode('const a = 1;', 'ts');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    // plain(text)フォールバックはトークン別の色を持たない。keyword の色が出ることが
    // 「実際に typescript として解決された」証拠になる。
    expect(containsTokenColor(result.value, 'var(--code-keyword)')).toBe(true);
  });

  it('markdown コードフェンスの略記 "js" はハイライトされる', async () => {
    const result = await highlightCode('const a = 1;', 'js');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(containsTokenColor(result.value, 'var(--code-keyword)')).toBe(true);
  });

  it('LANGUAGE_ALIASES に無い略記は plain(text)にフォールバックする', async () => {
    const result = await highlightCode('print(1)', 'py');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(containsTokenColor(result.value, 'var(--code-keyword)')).toBe(false);
  });

  it('LANGUAGE_ALIASES の値はすべて PRELOADED_LANGUAGE_KEYS に含まれる', () => {
    for (const language of Object.values(LANGUAGE_ALIASES)) {
      expect(PRELOADED_LANGUAGE_KEYS).toContain(language);
    }
  });
});
