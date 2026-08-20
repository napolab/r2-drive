import { useEffect, useMemo, useState } from 'react';

import { highlightCode } from '../../highlight/index';
import * as styles from './styles.css';

type Props = { readonly code: string; readonly language: string };

type CodeBlockState = { readonly kind: 'pending' } | { readonly kind: 'ready'; readonly html: string };

export const CodeBlock = ({ code, language }: Props) => {
  const [state, setState] = useState<CodeBlockState>({ kind: 'pending' });

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const html = await highlightCode(code, language);
      if (!controller.signal.aborted) setState({ kind: 'ready', html });
    };
    void run();

    return () => controller.abort();
  }, [code, language]);

  // react-perf(jsx-no-new-object-as-prop): dangerouslySetInnerHTML の引数オブジェクトを
  // 参照安定にする(memoization-in-props ルール)。ready でない間は html が空文字のまま
  // 参照だけが変わらないよう useMemo の外に出す。
  const readyHTML = state.kind === 'ready' ? state.html : '';
  const dangerousHTML = useMemo(() => ({ __html: readyHTML }), [readyHTML]);

  if (state.kind === 'pending') {
    return (
      <pre className={styles.plainPre}>
        <code>{code}</code>
      </pre>
    );
  }

  // shiki の出力は全テキストをエスケープ済み(highlight.test.ts の XSS ケースで固定)。
  return <div className={styles.root} dangerouslySetInnerHTML={dangerousHTML} />;
};
