import { codeComponents } from './code';
import { headingComponents } from './heading';
import { linkComponents } from './link';
import * as styles from './styles.css';
import { tableComponents } from './table';

import type { Components } from 'react-markdown';
import type { ComponentProps } from 'react';

const MarkdownP = ({ children }: ComponentProps<'p'>) => <p className={styles.paragraph}>{children}</p>;
const MarkdownUl = ({ children }: ComponentProps<'ul'>) => <ul className={styles.list}>{children}</ul>;
const MarkdownOl = ({ children }: ComponentProps<'ol'>) => <ol className={styles.list}>{children}</ol>;
const MarkdownBlockquote = ({ children }: ComponentProps<'blockquote'>) => <blockquote className={styles.blockquote}>{children}</blockquote>;

/**
 * react-markdown の `components` プロップに渡す、要素タグ → スタイル済みコンポーネントの対応表。
 * Payload の JSXConverters(napolab/www.napochaan.com の rich-text/converters)相当の役割で、
 * 各要素の見た目は converters 側(heading.tsx / table.tsx / link.tsx / code.tsx)がそれぞれ持つ。
 * react-perf(jsx-no-new-object-as-prop): module-level 定数にして参照を安定させる。
 */
export const markdownComponents: Components = {
  ...headingComponents,
  ...linkComponents,
  ...tableComponents,
  ...codeComponents,
  p: MarkdownP,
  ul: MarkdownUl,
  ol: MarkdownOl,
  blockquote: MarkdownBlockquote,
};
