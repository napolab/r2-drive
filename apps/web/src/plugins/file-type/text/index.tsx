import { err, ok } from 'neverthrow';
import { lazy } from 'react';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { HighlightLanguage } from '../../../highlight/index';
import type { FileTypePlugin, PreviewProps } from '../types';

// 拡張子 → shiki 言語。値は highlight/index.ts の LANGUAGE_IMPORTS のキーに
// 限定される(HighlightLanguage で型的に、text.test.tsx の sync テストで実行時に固定)。
export const EXTENSION_LANGUAGES = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.css': 'css',
  '.html': 'html',
  '.sh': 'bash',
  '.bash': 'bash',
  '.toml': 'toml',
} as const satisfies Record<string, HighlightLanguage>;

// ハイライトしないが text として開く拡張子
const PLAIN_EXTENSIONS = ['.txt', '.log', '.csv'];

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');

  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

export const languageOf = (name: string): HighlightLanguage | 'text' => {
  const extension = extensionOf(name);

  return extension in EXTENSION_LANGUAGES ? EXTENSION_LANGUAGES[extension as keyof typeof EXTENSION_LANGUAGES] : 'text';
};

const matches = (contentType: string, name: string): boolean => {
  if (contentType.startsWith('text/')) return true;
  const extension = extensionOf(name);

  return extension in EXTENSION_LANGUAGES || PLAIN_EXTENSIONS.includes(extension);
};

const TextPreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="doc" />
  </span>
);

const TextViewer = lazy(() => import('./viewer'));

// 既知の罠: .ts に video/mp2t が付いた場合は registry 順で video が先に取る(spec §6 で許容)。
export const textPlugin: FileTypePlugin = {
  id: 'text',
  run: (object) =>
    matches(object.contentType, object.name)
      ? ok({
          typeId: 'text',
          label: 'テキスト',
          Icon: (props) => <FileIcon {...props} glyph="doc" />,
          Preview: TextPreview,
          capability: { kind: 'view', Viewer: TextViewer },
        })
      : err(object),
};
