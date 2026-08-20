import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, useEffect, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';

import { highlightCode } from '../../highlight/index';
import * as styles from './styles.css';

import type { Components } from 'hast-util-to-jsx-runtime';
import type { ReactNode } from 'react';

type Props = { readonly code: string; readonly language: string };

// shiki が吐く <pre>(transparent な inline background と `.shiki` class を持つ)を、
// このプロジェクトの panda スタイルの <pre> へ置き換える。内側の <code> と
// token <span>(color:var(--code-*) を持つ)はそのまま素通しする。
const CodePre = ({ children }: { readonly children?: ReactNode }) => <pre className={styles.codeBlock}>{children}</pre>;

const components: Partial<Components> = { pre: CodePre };

// ready state は「どの (code, language) に対する結果か」を content と一緒に持つ。
// state 自体を props 変更時に同期リセットする代わりに、レンダー時に
// 「今の props と一致しない ready state」を pending 相当として扱う
// (render-time-derivation パターン)。useEffect の発火を待たずに済むため、
// props が変わった瞬間の描画で古いハイライト結果が一瞬でも出ることがない。
type CodeBlockState = { readonly kind: 'pending' } | { readonly kind: 'ready'; readonly code: string; readonly language: string; readonly content: ReactNode };

export const CodeBlock = ({ code, language }: Props) => {
  const [state, setState] = useState<CodeBlockState>({ kind: 'pending' });

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      await highlightCode(code, language).match(
        (hast) => {
          if (controller.signal.aborted) return;
          const content = toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
          setState({ kind: 'ready', code, language, content });
        },
        () => {
          // ハイライト失敗はビューアを空白にしてはならない(コーディング規約)。
          // state を更新せず、現在の props の生コードによる plain <pre> 表示のままにする。
        },
      );
    };
    void run();

    return () => controller.abort();
  }, [code, language]);

  const isStale = state.kind === 'ready' && (state.code !== code || state.language !== language);

  if (state.kind === 'pending' || isStale) {
    return (
      <pre className={styles.plainPre}>
        <code>{code}</code>
      </pre>
    );
  }

  return state.content;
};
