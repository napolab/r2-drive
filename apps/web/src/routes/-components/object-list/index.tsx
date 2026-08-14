import { token } from '@styled/tokens';
import { useCallback, useMemo } from 'react';
import { Collection, GridList, GridListItem, GridListLoadMoreItem, ListLayout, Virtualizer } from 'react-aria-components';

import { resolveFileType } from '../../../plugins/file-type/registry';
import * as styles from './styles.css';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';
import type { FocusEvent } from 'react';
import type { ListLayoutOptions, Selection } from 'react-aria-components';

// フォルダとオブジェクトを 1 つの union にまとめる。variant が増えたときに
// ObjectRow の switch がコンパイルエラーになる。
type Row = { readonly kind: 'folder'; readonly id: string; readonly folder: FolderDescriptor } | { readonly kind: 'object'; readonly id: string; readonly object: ObjectDescriptor };

type Props = {
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly onSelectionChange: (keys: Selection) => void;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onPrefetchFolder: (prefix: string) => void;
  // 1 ページ 200 件。末尾に近づいたら次のカーソルを取りに行く。これが無いと
  // 10,000 件のフォルダは最初の 200 件までしか到達できない(受け入れ基準 1)。
  readonly onLoadMore: () => void;
  readonly isLoadingMore: boolean;
};

// 行高は CSS(styles.css.ts の `h: 'targetComfortable'`)と ListLayout の両方が要る。
// 二重管理にしないため token から引く。sizes.targetComfortable = 44px(WCAG 2.1 の
// 実用的なタップ標的)。ListLayout は px 数値しか受けないので単位を落とす。
const ROW_SIZE = parseInt(token('sizes.targetComfortable'), 10);
const LAYOUT_OPTIONS = { rowSize: ROW_SIZE } satisfies ListLayoutOptions;
const ICON_SIZE = 16;

export const ObjectList = ({ folders, objects, onSelectionChange, onOpenFolder, onPrefetchFolder, onLoadMore, isLoadingMore }: Props) => {
  const rows: readonly Row[] = useMemo(
    () => [...folders.map((folder): Row => ({ kind: 'folder', id: `d:${folder.prefix}`, folder })), ...objects.map((object): Row => ({ kind: 'object', id: `f:${object.key}`, object }))],
    [folders, objects],
  );

  const renderRow = useCallback((row: Row) => <ObjectRow row={row} onOpenFolder={onOpenFolder} onPrefetchFolder={onPrefetchFolder} />, [onOpenFolder, onPrefetchFolder]);

  // GridListItem はフォーカスイベントを prop として公開していない(react-aria の
  // GlobalDOMAttributes はフォーカス系を持たない)。キーボード移動でも先読みしたいので、
  // display: contents のラッパでバブルしてきた focus を受け、行が data-prefix で
  // 公開している値を読む。レイアウトボックスは作らないので Virtualizer の測定に影響しない。
  const handleFocusPrefetch = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const { prefix } = event.target.dataset;
      if (prefix !== undefined) onPrefetchFolder(prefix);
    },
    [onPrefetchFolder],
  );

  return (
    // 選択状態は DOM ではなくコレクションが持つ。だから画面外の行を含む
    // 範囲選択(shift+矢印)や cmd+A が壊れない。素の仮想化ライブラリを被せると
    // この性質を自前で埋めることになる(spec §9.4)。
    <div className={styles.focusScope} onFocus={handleFocusPrefetch}>
      <Virtualizer layout={ListLayout} layoutOptions={LAYOUT_OPTIONS}>
        <GridList aria-label="オブジェクト一覧" className={styles.listRoot} selectionMode="multiple" onSelectionChange={onSelectionChange}>
          <Collection items={rows}>{renderRow}</Collection>
          {/* 末尾のセンチネル。次ページの取得もコレクションの一部なので、
              仮想化していても「下に着いたら続きが増える」が壊れない。 */}
          <GridListLoadMoreItem className={styles.loadMore} onLoadMore={onLoadMore} isLoading={isLoadingMore} />
        </GridList>
      </Virtualizer>
    </div>
  );
};

type RowProps = {
  readonly row: Row;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onPrefetchFolder: (prefix: string) => void;
};

const ObjectRow = ({ row, onOpenFolder, onPrefetchFolder }: RowProps) => {
  switch (row.kind) {
    case 'folder':
      return <FolderRow id={row.id} folder={row.folder} onOpenFolder={onOpenFolder} onPrefetchFolder={onPrefetchFolder} />;
    case 'object':
      return <FileRow id={row.id} object={row.object} />;
    default: {
      const _exhaustive: never = row;
      throw new Error(`unhandled row: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type FolderRowProps = {
  readonly id: string;
  readonly folder: FolderDescriptor;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onPrefetchFolder: (prefix: string) => void;
};

const FolderRow = ({ id, folder, onOpenFolder, onPrefetchFolder }: FolderRowProps) => {
  const handleAction = useCallback(() => onOpenFolder(folder.prefix), [folder.prefix, onOpenFolder]);
  // ホバー / フォーカスで先に取っておく。受け入れ基準 2(再訪が即座)の体感はこれが作る。
  const handlePrefetch = useCallback(() => onPrefetchFolder(folder.prefix), [folder.prefix, onPrefetchFolder]);

  return (
    <GridListItem id={id} textValue={folder.name} className={styles.row} data-kind="folder" data-prefix={folder.prefix} onAction={handleAction} onHoverStart={handlePrefetch}>
      <span className={styles.icon} aria-hidden="true">
        /
      </span>
      <span className={styles.name}>{folder.name}</span>
      <span className={styles.meta} />
      <span className={styles.meta} />
    </GridListItem>
  );
};

type FileRowProps = { readonly id: string; readonly object: ObjectDescriptor };

const FileRow = ({ id, object }: FileRowProps) => {
  const match = resolveFileType(object).unwrapOr(undefined);

  return (
    <GridListItem id={id} textValue={object.name} className={styles.row} data-kind="object">
      <span className={styles.icon}>{match !== undefined ? <match.Icon size={ICON_SIZE} /> : null}</span>
      <span className={styles.name}>{object.name}</span>
      <span className={styles.meta}>{object.size}</span>
      <span className={styles.meta}>{object.uploadedAt.slice(0, 10)}</span>
    </GridListItem>
  );
};
