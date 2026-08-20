import { useSuspenseQuery } from '@tanstack/react-query';

import { CodeBlock } from '../../../components/code-block/index';
import { ViewerTooLarge } from '../../../components/viewer-too-large/index';
import { objectTextQuery } from '../../../queries/object-text';
import { admitTextViewer } from '../text-viewer-limit';
import { languageOf } from './index';

import type { ViewerProps } from '../types';

const TextViewer = ({ object, getContentUrl }: ViewerProps) => {
  const admission = admitTextViewer(object.size);

  switch (admission.kind) {
    case 'too-large':
      return <ViewerTooLarge object={object} getContentUrl={getContentUrl} />;
    case 'ok':
      return <TextContent url={getContentUrl(object)} language={languageOf(object.name)} />;
    default: {
      const _exhaustive: never = admission;
      throw new Error(`unhandled admission: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const TextContent = ({ url, language }: { readonly url: string; readonly language: string }) => {
  const { data } = useSuspenseQuery(objectTextQuery(url));

  return <CodeBlock code={data} language={language} />;
};

export default TextViewer;
