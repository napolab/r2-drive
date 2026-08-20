import { useCallback, useMemo, useState } from 'react';
import { Collection, GridList, GridListItem, GridListLoadMoreItem, Virtualizer, useDragAndDrop } from 'react-aria-components';

import { FilePreviewIcon } from '../../../components/file-icon/index';
import { toExternalFiles } from '../../../upload/to-external-files/index';
import { getObjectRowId } from '../object-list/row-id';
import { SkylineLayout } from './skyline-layout/index';
import * as styles from './styles.css';

import type { ObjectDescriptor } from '@r2-drive/core';
import type { DroppableCollectionRootDropEvent, Selection } from 'react-aria-components';
import type { Key } from '@react-types/shared';

type Props = {
  readonly objects: readonly ObjectDescriptor[];
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly selectedKeys: Selection;
  readonly onSelectionChange: (keys: Selection) => void;
  readonly onOpenObject: (key: string) => void;
  readonly onExternalFiles: (files: readonly File[]) => void;
  readonly onExternalFileError: (error: Error) => void;
  readonly onLoadMore: () => void;
  readonly isLoadingMore: boolean;
};

// ユーザー要望(2026-08-21)によりギャラリーは画像 + 動画のみ。フォルダ・他ファイルは
// タイルビューの役割(チップ列は廃止した)。
export const isGalleryMedia = (object: ObjectDescriptor): boolean => object.contentType.startsWith('image/') || object.contentType.startsWith('video/');

// object-list と同じ理由(spec §6.2: 選択・cmd+A・Delete・D&D 取り込みは GridList /
// Virtualizer の既存機能のまま)。gallery でも一覧へのファイルドロップでアップロード
// できる必要がある。
class ExternalFileReadError extends Error {
  override name = 'ExternalFileReadError';
}

export const GalleryView = ({ objects, getContentUrl, selectedKeys, onSelectionChange, onOpenObject, onExternalFiles, onExternalFileError, onLoadMore, isLoadingMore }: Props) => {
  const mediaObjects = useMemo(() => objects.filter(isGalleryMedia), [objects]);

  // ratioOf は key ごとに毎回 O(n) で objects を舐めない — 実装では Map 化する
  // (Task 8 brief の指示どおり)。GridListItem の id は選択モデルの共有キー
  // (getObjectRowId = `f:${key}`)を使う(下記 GalleryMediaCell 参照)ので、
  // SkylineLayout が渡してくる key もその形になる — Map もそれで引く。
  // 動画は索引に寸法を持たない(mediaFactsHook は image/* だけを probe する)ので、
  // media.kind !== 'image' の分岐で自然に ratio=1(正方形)になる。
  const mediaByKey = useMemo(() => new Map(mediaObjects.map((object) => [getObjectRowId(object), object])), [mediaObjects]);
  const ratioOf = useCallback(
    (key: Key) => {
      const object = mediaByKey.get(`${key}`);
      return object !== undefined && object.media.kind === 'image' ? object.media.height / object.media.width : 1;
    },
    [mediaByKey],
  );
  const layoutOptions = useMemo(() => ({ ratioOf }), [ratioOf]);

  // react-aria の cmd+A は Selection = 'all' という抽象センチネルを渡す。共有 state
  // (resolveSelectedRows, model.ts)はこれをルートレベルの folders+objects に対して
  // 実体化するため、そのまま流すと gallery が表示していないフォルダ/非メディアまで
  // 選択対象に含まれてしまう(folder ガードの誤爆・非表示ファイルへの誤操作)。
  // gallery 由来の選択は常に具体的な id 集合として共有 state に渡す。
  const handleGallerySelectionChange = useCallback(
    (selection: Selection) => onSelectionChange(selection === 'all' ? new Set(mediaObjects.map(getObjectRowId)) : selection),
    [mediaObjects, onSelectionChange],
  );

  const renderMedia = useCallback(
    (object: ObjectDescriptor) => <GalleryMediaCell key={object.key} object={object} getContentUrl={getContentUrl} onOpenObject={onOpenObject} />,
    [getContentUrl, onOpenObject],
  );

  // object-list の handleRootDrop と同じ形。toExternalFiles で読み取り、失敗は
  // ExternalFileReadError に包んで onExternalFileError へ渡す。
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
  const dragAndDropOptions = useMemo(() => ({ acceptedDragTypes: 'all' as const, onRootDrop: handleRootDrop }), [handleRootDrop]);
  const { dragAndDropHooks } = useDragAndDrop(dragAndDropOptions);

  return (
    <div className={styles.root}>
      <Virtualizer layout={SkylineLayout} layoutOptions={layoutOptions}>
        <GridList
          aria-label="メディア一覧"
          className={styles.gridRoot}
          layout="grid"
          selectionMode="multiple"
          selectedKeys={selectedKeys}
          onSelectionChange={handleGallerySelectionChange}
          dragAndDropHooks={dragAndDropHooks}
        >
          <Collection items={mediaObjects}>{renderMedia}</Collection>
          {/* 末尾のセンチネル。object-list と同じく、次ページの取得もコレクションの一部。 */}
          <GridListLoadMoreItem className={styles.loadMore} onLoadMore={onLoadMore} isLoading={isLoadingMore} />
        </GridList>
      </Virtualizer>
    </div>
  );
};

// ---------------------------------------------------------------------------
// メディアセル — skyline GridList の中身。画像 / 動画で描画する要素だけが違う。
// ---------------------------------------------------------------------------

type GalleryMediaCellProps = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onOpenObject: (key: string) => void;
};

// 読み込み失敗はアイコン + ファイル名にフォールバックする(Phase 2 の Preview と同じ思想)。
// 動画は先頭フレームをサムネイルとして使う(preload="metadata")— controls は付けない。
// このセルはタイルであってプレイヤーではなく、再生は onAction で開く `?view=` ビューアの仕事。
const renderMediaCellContent = (object: ObjectDescriptor, getContentUrl: (object: ObjectDescriptor) => string, hasLoadError: boolean, onError: () => void) => {
  const isVideo = object.contentType.startsWith('video/');

  if (hasLoadError) {
    return (
      <span className={styles.cellFallback} data-preview-kind="icon">
        <FilePreviewIcon glyph={isVideo ? 'video' : 'image'} />
        <span className={styles.cellFallbackName}>{object.name}</span>
      </span>
    );
  }

  return isVideo ? (
    <video className={styles.cellImage} src={getContentUrl(object)} preload="metadata" muted playsInline draggable={false} onError={onError} />
  ) : (
    // media none(寸法不明)でも正方形セルとして描画する — ratioOf の既定 1 が
    // その形を決め、object-fit: cover がトリミングを担う(design-direction §7)。
    <img className={styles.cellImage} src={getContentUrl(object)} alt="" loading="lazy" decoding="async" draggable={false} onError={onError} />
  );
};

const GalleryMediaCell = ({ object, getContentUrl, onOpenObject }: GalleryMediaCellProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);
  const handleAction = useCallback(() => onOpenObject(object.key), [object.key, onOpenObject]);

  return (
    // id は選択モデルの共有キー(getObjectRowId = `f:${key}`)。object-list の FileRow
    // と同じ id を使うことで、Task 9 でセレクションを共有しても bulk actions や
    // folder ガードから gallery の選択が漏れない。onAction 側は viewer 契約(生 key)
    // のまま — object.key を渡す(id とは別物)。
    <GridListItem id={getObjectRowId(object)} textValue={object.name} className={styles.cell} onAction={handleAction}>
      {renderMediaCellContent(object, getContentUrl, hasLoadError, handleError)}
    </GridListItem>
  );
};
