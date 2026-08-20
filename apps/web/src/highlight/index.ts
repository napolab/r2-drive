import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import { ResultAsync } from 'neverthrow';

import type { HighlighterCore } from 'shiki/core';
import type { ThemeRegistrationRaw } from '@shikijs/types';
import type { Root } from 'hast';

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

// markdown コードフェンスは ```ts / ```js のような短縮/別名を使うことが多い。
// 値は LANGUAGE_IMPORTS のキーに限定される(Record<string, HighlightLanguage> で
// 型的に、highlight.test.ts の sync テストで実行時に固定する)。
// isHighlightLanguage / HighlightLanguage の既存の意味(= LANGUAGE_IMPORTS の
// キーそのものか)は変えない。別名解決は resolveLanguage 側だけの責務にする
// (text プラグインの EXTENSION_LANGUAGES はこの表を経由しない、拡張子は最初から
// 正式名で書かれているため)。
export const LANGUAGE_ALIASES = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  yml: 'yaml',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  md: 'markdown',
} as const satisfies Record<string, HighlightLanguage>;

const isHighlightLanguageAlias = (value: string): value is keyof typeof LANGUAGE_ALIASES => value in LANGUAGE_ALIASES;

const resolveLanguage = (value: string): HighlightLanguage | 'text' => {
  if (isHighlightLanguage(value)) return value;
  if (isHighlightLanguageAlias(value)) return LANGUAGE_ALIASES[value];

  return 'text';
};

const CODE_THEME_NAME = 'r2-drive-code';

// TextMate scope を CSS 変数へ直接マップする raw theme(www.napochaan.com の
// highlighter/index.ts を移植)。色の実値は code-block/styles.css.ts が
// colors.code.* token から与える(strictTokens と AA テストの保護をハイライトにも通す)。
// background は transparent にして、パネル側の背景(code.bg)を透過させる。
const CODE_THEME: ThemeRegistrationRaw = {
  name: CODE_THEME_NAME,
  type: 'light',
  settings: [
    { settings: { foreground: 'var(--code-fg)', background: 'transparent' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--code-comment)' } },
    {
      scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control', 'keyword.operator'],
      settings: { foreground: 'var(--code-keyword)' },
    },
    {
      scope: ['string', 'string.quoted', 'punctuation.definition.string', 'constant.other.symbol'],
      settings: { foreground: 'var(--code-string)' },
    },
    { scope: ['constant.numeric', 'constant.language', 'constant.character'], settings: { foreground: 'var(--code-number)' } },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call', 'entity.name.tag'],
      settings: { foreground: 'var(--code-function)' },
    },
    { scope: ['punctuation', 'meta.brace', 'meta.delimiter'], settings: { foreground: 'var(--code-punctuation)' } },
  ],
};

// grammar は積まず theme だけ持って起動する。言語は highlightCode が要求時に load する
// (loadLanguage は冪等なので都度 await してよい)。
const highlighterPromise: Promise<HighlighterCore> = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [CODE_THEME],
});

export class HighlightError extends Error {
  override name = 'HighlightError';
}

const codeToHast = async (code: string, resolved: HighlightLanguage | 'text'): Promise<Root> => {
  const highlighter = await highlighterPromise;
  if (resolved === 'text') return highlighter.codeToHast(code, { lang: 'text', theme: CODE_THEME_NAME });

  await highlighter.loadLanguage(LANGUAGE_IMPORTS[resolved]);

  return highlighter.codeToHast(code, { lang: resolved, theme: CODE_THEME_NAME });
};

export const highlightCode = (code: string, language: string): ResultAsync<Root, HighlightError> => {
  const resolved = resolveLanguage(language);

  return ResultAsync.fromPromise(codeToHast(code, resolved), (cause) => new HighlightError('コードのハイライトに失敗しました', { cause }));
};
