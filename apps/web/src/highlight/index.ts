import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import type { HighlighterCore } from 'shiki/core';

// バンドラ制約: dynamic import のパスはリテラルでなければならない。
// この Record が言語リストの唯一の出典であり、PRELOADED_LANGUAGE_KEYS は
// ここから導出する(cross-module-sync-test: text プラグインの拡張子マップとの
// 整合は highlight.test.ts / text.test.tsx が固定する)。
const LANGUAGE_IMPORTS = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  css: () => import('@shikijs/langs/css'),
  html: () => import('@shikijs/langs/html'),
  bash: () => import('@shikijs/langs/bash'),
  toml: () => import('@shikijs/langs/toml'),
  markdown: () => import('@shikijs/langs/markdown'),
} as const;

export type HighlightLanguage = keyof typeof LANGUAGE_IMPORTS;

export const PRELOADED_LANGUAGE_KEYS = Object.keys(LANGUAGE_IMPORTS) as readonly HighlightLanguage[];

export const isHighlightLanguage = (value: string): value is HighlightLanguage => value in LANGUAGE_IMPORTS;

// 色は theme に埋めず CSS 変数で受ける。実際の色は code-block/styles.css.ts が
// colors.code.* token から与える(strictTokens と AA テストの保護をハイライトにも通す)。
const cssVariablesTheme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true });

// grammar は積まず theme だけ持って起動する。言語は highlightCode が要求時に load する
// (loadLanguage は冪等なので都度 await してよい)。
const highlighterPromise: Promise<HighlighterCore> = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [cssVariablesTheme],
});

export const highlightCode = async (code: string, language: string): Promise<string> => {
  const highlighter = await highlighterPromise;
  if (!isHighlightLanguage(language)) return highlighter.codeToHtml(code, { lang: 'text', theme: 'css-variables' });
  await highlighter.loadLanguage(LANGUAGE_IMPORTS[language]);

  return highlighter.codeToHtml(code, { lang: language, theme: 'css-variables' });
};
