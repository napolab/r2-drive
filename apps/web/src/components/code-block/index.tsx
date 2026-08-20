import { useEffect, useMemo, useState } from 'react';

import { highlightCode } from '../../highlight/index';
import * as styles from './styles.css';

type Props = { readonly code: string; readonly language: string };

// ready state は「どの (code, language) に対する結果か」を html と一緒に持つ。
// state 自体を props 変更時に同期リセットする代わりに、レンダー時に
// 「今の props と一致しない ready state」を pending 相当として扱う
// (render-time-derivation パターン)。useEffect の発火を待たずに済むため、
// props が変わった瞬間の描画で古い HTML が一瞬でも出ることがない。
type CodeBlockState = { readonly kind: 'pending' } | { readonly kind: 'ready'; readonly code: string; readonly language: string; readonly html: string };

export const CodeBlock = ({ code, language }: Props) => {
  const [state, setState] = useState<CodeBlockState>({ kind: 'pending' });

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const html = await highlightCode(code, language);
      if (!controller.signal.aborted) setState({ kind: 'ready', code, language, html });
    };
    void run();

    return () => controller.abort();
  }, [code, language]);

  const isStale = state.kind === 'ready' && (state.code !== code || state.language !== language);
  const readyHTML = state.kind === 'ready' && !isStale ? state.html : '';

  // react-perf(jsx-no-new-object-as-prop): dangerouslySetInnerHTML の引数オブジェクトを
  // 参照安定にする(memoization-in-props ルール)。
  const dangerousHTML = useMemo(() => ({ __html: readyHTML }), [readyHTML]);

  if (state.kind === 'pending' || isStale) {
    return (
      <pre className={styles.plainPre}>
        <code>{code}</code>
      </pre>
    );
  }

  // shiki の出力は全テキストをエスケープ済み(highlight.test.ts の XSS ケースで固定)。
  return <div className={styles.root} dangerouslySetInnerHTML={dangerousHTML} />;
};
