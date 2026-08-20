import { useSuspenseQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ViewerHeadPreview } from '../../../components/viewer-head-preview/index';
import { objectTextQuery } from '../../../queries/object-text';
import { admitTextViewer } from '../text-viewer-limit';
import { markdownComponents } from './components/index';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';

// react-perf(jsx-no-new-array-as-prop): Markdown の remarkPlugins 配列を参照安定にする。
const remarkPlugins = [remarkGfm];

const MarkdownViewer = ({ object, getContentUrl }: ViewerProps) => {
  const admission = admitTextViewer(object.size);

  switch (admission.kind) {
    case 'too-large':
      return <ViewerHeadPreview object={object} getContentUrl={getContentUrl} language="markdown" />;
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
