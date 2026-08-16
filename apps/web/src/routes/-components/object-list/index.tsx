import { token } from '@styled/tokens';
import { useCallback, useMemo, useRef } from 'react';
import { useContextMenu } from 'react-aria/useContextMenu';
import { Collection, GridLayout, GridList, GridListItem, GridListLoadMoreItem, Size, useDragAndDrop, Virtualizer } from 'react-aria-components';

import { FilePreviewIcon } from '../../../components/file-icon/index';
import { resolveFileType } from '../../../plugins/file-type/registry';
import { toExternalFiles } from '../../../upload/to-external-files/index';
import { getFolderRowId, getObjectRowId } from './row-id';
import * as styles from './styles.css';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';
import type { FocusEvent, KeyboardEvent, SyntheticEvent } from 'react';
import type { DroppableCollectionRootDropEvent, GridLayoutOptions, Selection } from 'react-aria-components';

// フォルダとオブジェクトを 1 つの union にまとめる。variant が増えたときに
// ObjectRow の switch がコンパイルエラーになる。
type Row = { readonly kind: 'folder'; readonly id: string; readonly folder: FolderDescriptor } | { readonly kind: 'object'; readonly id: string; readonly object: ObjectDescriptor };

type Props = {
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly selectedKeys: Selection;
  readonly onSelectionChange: (keys: Selection) => void;
  readonly onDeleteRequest: () => void;
  readonly onObjectContextMenu: (object: ObjectDescriptor, point: { readonly x: number; readonly y: number }, trigger: HTMLElement) => void;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onPrefetchFolder: (prefix: string) => void;
  readonly onExternalFiles: (files: readonly File[]) => void;
  readonly onExternalFileError: (error: Error) => void;
  // 1 ページ 200 件。末尾に近づいたら次のカーソルを取りに行く。これが無いと
  // 10,000 件のフォルダは最初の 200 件までしか到達できない(受け入れ基準 1)。
  readonly onLoadMore: () => void;
  readonly isLoadingMore: boolean;
};

// GridLayout は px 数値を受け取るので、CSS と同じ sizing token から単位を落とす。
// 7 × 10 grid cell の固定比率を preserveAspectRatio で維持し、名前の長さによる
// item measurement の揺れを止める。
const TILE_WIDTH = parseInt(token('sizes.fileTileWidth'), 10);
const TILE_HEIGHT = parseInt(token('sizes.fileTileHeight'), 10);
const TILE_GAP = parseInt(token('sizes.fileTileGap'), 10);
const LAYOUT_OPTIONS = {
  minItemSize: new Size(TILE_WIDTH, TILE_HEIGHT),
  maxItemSize: new Size(TILE_WIDTH, TILE_HEIGHT),
  minSpace: new Size(TILE_GAP, TILE_GAP),
  maxHorizontalSpace: TILE_GAP,
  preserveAspectRatio: true,
} satisfies GridLayoutOptions;

class ExternalFileReadError extends Error {
  override name = 'ExternalFileReadError';
}

export const ObjectList = ({
  folders,
  objects,
  getContentUrl,
  selectedKeys,
  onSelectionChange,
  onDeleteRequest,
  onObjectContextMenu,
  onOpenFolder,
  onPrefetchFolder,
  onExternalFiles,
  onExternalFileError,
  onLoadMore,
  isLoadingMore,
}: Props) => {
  const rows: readonly Row[] = useMemo(
    () => [...folders.map((folder): Row => ({ kind: 'folder', id: getFolderRowId(folder), folder })), ...objects.map((object): Row => ({ kind: 'object', id: getObjectRowId(object), object }))],
    [folders, objects],
  );
  const objectsByRowId = useMemo(() => new Map(objects.map((object) => [getObjectRowId(object), object])), [objects]);
  const contextTarget = useRef<HTMLElement | undefined>(undefined);

  const renderRow = useCallback(
    (row: Row) => <ObjectRow row={row} getContentUrl={getContentUrl} onOpenFolder={onOpenFolder} onPrefetchFolder={onPrefetchFolder} />,
    [getContentUrl, onOpenFolder, onPrefetchFolder],
  );

  // GridListItem はフォーカスイベントを prop として公開していない(react-aria の
  // GlobalDOMAttributes はフォーカス系を持たない)。キーボード移動でも先読みしたいので、
  // display: contents のラッパでバブルしてきた focus を受け、tile が data-prefix で
  // 公開している値を読む。レイアウトボックスは作らないので Virtualizer の測定に影響しない。
  const handleFocusPrefetch = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const { prefix } = event.target.dataset;
      if (prefix !== undefined) onPrefetchFolder(prefix);
    },
    [onPrefetchFolder],
  );

  const handleRootDrop = useCallback(
    async (event: DroppableCollectionRootDropEvent) => {
      try {
        const files = await toExternalFiles(event.items);
        if (files.length > 0) onExternalFiles(files);
      } catch (cause) {
        onExternalFileError(new ExternalFileReadError('ドロップしたファイルを読み込めませんでした', { cause }));
      }
    },
    [onExternalFileError, onExternalFiles],
  );
  const { dragAndDropHooks } = useDragAndDrop<Row>({ acceptedDragTypes: 'all', onRootDrop: handleRootDrop });
  const rememberContextTarget = useCallback((event: SyntheticEvent) => {
    const target = event.target instanceof Element ? event.target.closest('[data-kind="object"]') : null;
    contextTarget.current = target instanceof HTMLElement ? target : undefined;
  }, []);
  const { contextMenuProps } = useContextMenu({
    onContextMenu: (event) => {
      const trigger = contextTarget.current;
      const rowId = trigger?.dataset.key;
      const object = rowId === undefined ? undefined : objectsByRowId.get(rowId);
      if (trigger === undefined || object === undefined) return;
      const rect = event.target.getBoundingClientRect();
      onObjectContextMenu(object, { x: rect.left + event.x, y: rect.top + event.y }, trigger);
    },
  });
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      rememberContextTarget(event);
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedKeys === 'all' || selectedKeys.size > 0)) {
        event.preventDefault();
        onDeleteRequest();
      }
    },
    [onDeleteRequest, rememberContextTarget, selectedKeys],
  );

  return (
    // 選択状態は DOM ではなくコレクションが持つ。だから画面外の tile を含む
    // 範囲選択(shift+矢印)や cmd+A が壊れない。素の仮想化ライブラリを被せると
    // この性質を自前で埋めることになる(spec §9.4)。
    <div
      {...contextMenuProps}
      className={styles.focusScope}
      onFocus={handleFocusPrefetch}
      onContextMenuCapture={rememberContextTarget}
      onPointerDownCapture={rememberContextTarget}
      onKeyDownCapture={handleKeyDown}
    >
      <Virtualizer layout={GridLayout} layoutOptions={LAYOUT_OPTIONS}>
        <GridList
          aria-label="オブジェクト一覧"
          className={styles.listRoot}
          layout="grid"
          selectionMode="multiple"
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          dragAndDropHooks={dragAndDropHooks}
        >
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
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onPrefetchFolder: (prefix: string) => void;
};

const ObjectRow = ({ row, getContentUrl, onOpenFolder, onPrefetchFolder }: RowProps) => {
  switch (row.kind) {
    case 'folder':
      return <FolderRow id={row.id} folder={row.folder} onOpenFolder={onOpenFolder} onPrefetchFolder={onPrefetchFolder} />;
    case 'object':
      return <FileRow id={row.id} object={row.object} getContentUrl={getContentUrl} />;
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
    <GridListItem id={id} textValue={folder.name} className={styles.tile} data-kind="folder" data-prefix={folder.prefix} onAction={handleAction} onHoverStart={handlePrefetch}>
      <div className={styles.tileGrid}>
        <span className={styles.previewRoot} data-preview-kind="folder">
          <FilePreviewIcon glyph="folder" />
        </span>
        <span className={styles.nameRoot}>
          <span className={styles.name}>{folder.name}</span>
        </span>
        <span className={styles.metaRoot}>
          <span>DIR</span>
          <span>フォルダ</span>
        </span>
      </div>
    </GridListItem>
  );
};

type FileRowProps = {
  readonly id: string;
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

const FileRow = ({ id, object, getContentUrl }: FileRowProps) => {
  const match = resolveFileType(object).unwrapOr(undefined);
  const previewIdentity = JSON.stringify([object.bucketId, object.key, object.etag]);

  return (
    <GridListItem id={id} textValue={object.name} className={styles.tile} data-kind="object">
      <div className={styles.tileGrid}>
        <span className={styles.previewRoot}>{match !== undefined ? <match.Preview key={previewIdentity} object={object} getContentUrl={getContentUrl} /> : null}</span>
        <span className={styles.nameRoot}>
          <span className={styles.name}>{object.name}</span>
        </span>
        <span className={styles.metaRoot}>
          <span>{object.size} B</span>
          <span>{match?.label}</span>
        </span>
      </div>
    </GridListItem>
  );
};
