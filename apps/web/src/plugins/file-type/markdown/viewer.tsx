import { useSuspenseQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CodeBlock } from '../../../components/code-block/index';
import { ViewerTooLarge } from '../../../components/viewer-too-large/index';
import { objectTextQuery } from '../../../queries/object-text';
import { admitTextViewer } from '../text-viewer-limit';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';
import type { ComponentProps } from 'react';

// react-perf(jsx-no-new-array-as-prop): Markdown の remarkPlugins 配列を参照安定にする。
const remarkPlugins = [remarkGfm];

// react-markdown はコードブロックを <code className="language-xxx"> で渡してくる。
// className が無いものはインラインコード。
const MarkdownCode = ({ className, children }: ComponentProps<'code'>) => {
  const language = /language-(\w+)/.exec(className ?? '')?.[1];
  if (language === undefined) return <code className={styles.inlineCode}>{children}</code>;

  return <CodeBlock code={`${children}`.replace(/\n$/, '')} language={language} />;
};

// react-perf(jsx-no-new-object-as-prop): Markdown の components オブジェクトを参照安定にする。
const markdownComponents = { code: MarkdownCode };

const MarkdownViewer = ({ object, getContentUrl }: ViewerProps) => {
  const admission = admitTextViewer(object.size);

  switch (admission.kind) {
    case 'too-large':
      return <ViewerTooLarge object={object} getContentUrl={getContentUrl} />;
    case 'ok':
      return <MarkdownContent url={getContentUrl(object)} />;
    default: {
      const _exhaustive: never = admission;
      throw new Error(`unhandled admission: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const MarkdownContent = ({ url }: { readonly url: string }) => {
  const { data } = useSuspenseQuery(objectTextQuery(url));

  return (
    <article className={styles.markdownRoot}>
      <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {data}
      </Markdown>
    </article>
  );
};

export default MarkdownViewer;
