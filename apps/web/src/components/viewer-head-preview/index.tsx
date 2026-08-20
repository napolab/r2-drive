import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from 'react-aria-components';

import { CodeBlock } from '../code-block/index';
import { objectTextHeadQuery } from '../../queries/object-text';
import * as styles from './styles.css';

import type { ObjectDescriptor } from '@r2-drive/core';

export const HEAD_PREVIEW_MAX_LINES = 300;

type HeadLines = { readonly kind: 'complete'; readonly text: string } | { readonly kind: 'truncated'; readonly text: string };

// 純関数: text を改行で分割し、先頭 maxLines 行だけを返す。maxLines 以下ならそのまま complete。
// 実際にファイル全体が 1 MiB 超かどうかは呼び出し側(ViewerHeadPreview)が知っている前提で、
// この関数自体は渡された text の行数だけを見て判定する。
export const headLines = (text: string, maxLines: number): HeadLines => {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { kind: 'complete', text };

  return { kind: 'truncated', text: lines.slice(0, maxLines).join('\n') };
};

type Props = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly language: string;
};

const byteFormat = new Intl.NumberFormat('en-US');

// 1 MiB 超のテキスト系ファイル用。全文を fetch せず、Range で先頭 128 KiB だけ取得し
// (objectTextHeadQuery)、そこから先頭 300 行だけを表示する。全体は常に上限超過なので
// truncated 表示 + ダウンロード導線を常に出す(spec §6.2)。
export const ViewerHeadPreview = ({ object, getContentUrl, language }: Props) => {
  const url = getContentUrl(object);
  const { data } = useSuspenseQuery(objectTextHeadQuery(url));
  const head = headLines(data, HEAD_PREVIEW_MAX_LINES);

  return (
    <div className={styles.root}>
      <p className={styles.notice}>
        先頭 {HEAD_PREVIEW_MAX_LINES} 行のみ表示(全体 <span className={styles.size}>{byteFormat.format(object.size)} B</span>)
        <Link className={styles.download} href={url} download={object.name}>
          ダウンロード
        </Link>
      </p>
      <CodeBlock code={head.text} language={language} />
    </div>
  );
};
