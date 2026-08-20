import { CodeBlock } from '../../../../components/code-block/index';
import * as styles from './styles.css';

import type { ComponentProps } from 'react';

// react-markdown はコードブロックを <code className="language-xxx"> で渡してくる。
// className が無いものはインラインコード。
const MarkdownCode = ({ className, children }: ComponentProps<'code'>) => {
  const language = /language-(\w+)/.exec(className ?? '')?.[1];
  if (language === undefined) return <code className={styles.inlineCode}>{children}</code>;

  return <CodeBlock code={`${children}`.replace(/\n$/, '')} language={language} />;
};

export const codeComponents = { code: MarkdownCode };
