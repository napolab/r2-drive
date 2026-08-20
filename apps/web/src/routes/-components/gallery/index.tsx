import { token } from '@styled/tokens';
import { useCallback, useMemo, useState } from 'react';
import { Button, Collection, GridList, GridListItem, GridListLoadMoreItem, Virtualizer } from 'react-aria-components';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';
import { resolveFileType } from '../../../plugins/file-type/registry';
import { SkylineLayout } from './skyline-layout/index';
import * as styles from './styles.css';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';
import type { Selection } from 'react-aria-components';
import type { Key } from '@react-types/shared';

type Props = {
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly selectedKeys: Selection;
  readonly onSelectionChange: (keys: Selection) => void;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onOpenObject: (key: string) => void;
  readonly onLoadMore: () => void;
  readonly isLoadingMore: boolean;
};

export const isGalleryImage = (object: ObjectDescriptor): boolean => object.contentType.startsWith('image/');

const CHIP_ICON_SIZE = parseInt(token('sizes.chipIcon'), 10);

export const GalleryView = ({ folders, objects, getContentUrl, selectedKeys, onSelectionChange, onOpenFolder, onOpenObject, onLoadMore, isLoadingMore }: Props) => {
  const images = useMemo(() => objects.filter(isGalleryImage), [objects]);
  const others = useMemo(() => objects.filter((object) => !isGalleryImage(object)), [objects]);

  // ratioOf は key ごとに毎回 O(n) で objects を舐めない — 実装では Map 化する
  // (Task 8 brief の指示どおり)。
  const imagesByKey = useMemo(() => new Map(images.map((object) => [object.key, object])), [images]);
  const ratioOf = useCallback(
    (key: Key) => {
      const object = imagesByKey.get(`${key}`);
      return object !== undefined && object.media.kind === 'image' ? object.media.height / object.media.width : 1;
    },
    [imagesByKey],
  );
  const layoutOptions = useMemo(() => ({ ratioOf }), [ratioOf]);

  const renderImage = useCallback(
    (object: ObjectDescriptor) => <GalleryImageCell key={object.key} object={object} getContentUrl={getContentUrl} onOpenObject={onOpenObject} />,
    [getContentUrl, onOpenObject],
  );

  return (
    <div className={styles.root}>
      <ChipList folders={folders} objects={others} onOpenFolder={onOpenFolder} onOpenObject={onOpenObject} />
      <Virtualizer layout={SkylineLayout} layoutOptions={layoutOptions}>
        <GridList aria-label="画像一覧" className={styles.gridRoot} selectionMode="multiple" selectedKeys={selectedKeys} onSelectionChange={onSelectionChange}>
          <Collection items={images}>{renderImage}</Collection>
          {/* 末尾のセンチネル。object-list と同じく、次ページの取得もコレクションの一部。 */}
          <GridListLoadMoreItem className={styles.loadMore} onLoadMore={onLoadMore} isLoading={isLoadingMore} />
        </GridList>
      </Virtualizer>
    </div>
  );
};

// ---------------------------------------------------------------------------
// チップ列 — フォルダと非画像ファイルを平坦な行として並べる。20 件を超えたら畳む。
// ---------------------------------------------------------------------------

const COLLAPSED_CHIP_COUNT = 20;

type ChipListState = { readonly kind: 'collapsed' } | { readonly kind: 'expanded' };

type ChipEntry = { readonly kind: 'folder'; readonly folder: FolderDescriptor } | { readonly kind: 'object'; readonly object: ObjectDescriptor };

type ChipListProps = {
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly onOpenFolder: (prefix: string) => void;
  readonly onOpenObject: (key: string) => void;
};

const chipKey = (entry: ChipEntry): string => (entry.kind === 'folder' ? `folder:${entry.folder.prefix}` : `object:${entry.object.key}`);

const renderChipEntry = (entry: ChipEntry, onOpenFolder: (prefix: string) => void, onOpenObject: (key: string) => void) => {
  switch (entry.kind) {
    case 'folder':
      return <FolderChip key={chipKey(entry)} folder={entry.folder} onOpenFolder={onOpenFolder} />;
    case 'object':
      return <ObjectChip key={chipKey(entry)} object={entry.object} onOpenObject={onOpenObject} />;
    default: {
      const _exhaustive: never = entry;
      throw new Error(`unhandled chip entry: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const ChipList = ({ folders, objects, onOpenFolder, onOpenObject }: ChipListProps) => {
  const [state, setState] = useState<ChipListState>({ kind: 'collapsed' });
  const handleExpand = useCallback(() => setState({ kind: 'expanded' }), []);

  const entries = useMemo<readonly ChipEntry[]>(
    () => [...folders.map((folder): ChipEntry => ({ kind: 'folder', folder })), ...objects.map((object): ChipEntry => ({ kind: 'object', object }))],
    [folders, objects],
  );

  if (entries.length === 0) return null;

  const isCollapsible = entries.length > COLLAPSED_CHIP_COUNT;
  const visibleEntries = state.kind === 'expanded' || !isCollapsible ? entries : entries.slice(0, COLLAPSED_CHIP_COUNT);
  const hiddenCount = entries.length - COLLAPSED_CHIP_COUNT;

  return (
    <div className={styles.chipListRoot} aria-label="フォルダとファイル">
      {visibleEntries.map((entry) => renderChipEntry(entry, onOpenFolder, onOpenObject))}
      {isCollapsible && state.kind === 'collapsed' ? (
        <Button className={styles.chipMore} onPress={handleExpand}>
          他 {hiddenCount} 件
        </Button>
      ) : null}
    </div>
  );
};

type FolderChipProps = { readonly folder: FolderDescriptor; readonly onOpenFolder: (prefix: string) => void };

const FolderChip = ({ folder, onOpenFolder }: FolderChipProps) => {
  const handlePress = useCallback(() => onOpenFolder(folder.prefix), [folder.prefix, onOpenFolder]);

  return (
    <Button className={styles.chip} data-kind="folder" onPress={handlePress}>
      <FileIcon size={CHIP_ICON_SIZE} glyph="folder" />
      <span className={styles.chipLabel}>{folder.name}</span>
    </Button>
  );
};

type ObjectChipProps = { readonly object: ObjectDescriptor; readonly onOpenObject: (key: string) => void };

// opaque(view capability を持たない)ファイルは onPress を持たせない — FileRow
// (object-list/index.tsx)と同じ conditional spread(exactOptionalPropertyTypes 対応)。
const ObjectChip = ({ object, onOpenObject }: ObjectChipProps) => {
  const match = resolveFileType(object).unwrapOr(undefined);
  const canOpen = match !== undefined && match.capability.kind === 'view';
  const handlePress = useCallback(() => onOpenObject(object.key), [object.key, onOpenObject]);

  return (
    <Button className={styles.chip} data-kind="object" isDisabled={!canOpen} {...(canOpen ? { onPress: handlePress } : {})}>
      {match !== undefined ? <match.Icon size={CHIP_ICON_SIZE} /> : <FileIcon size={CHIP_ICON_SIZE} glyph="blank" />}
      <span className={styles.chipLabel}>{object.name}</span>
    </Button>
  );
};

// ---------------------------------------------------------------------------
// 画像セル — skyline GridList の中身。
// ---------------------------------------------------------------------------

type GalleryImageCellProps = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onOpenObject: (key: string) => void;
};

const GalleryImageCell = ({ object, getContentUrl, onOpenObject }: GalleryImageCellProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);
  const handleAction = useCallback(() => onOpenObject(object.key), [object.key, onOpenObject]);

  return (
    <GridListItem id={object.key} textValue={object.name} className={styles.cell} onAction={handleAction}>
      {hasLoadError ? (
        <span className={styles.cellFallback} data-preview-kind="icon">
          <FilePreviewIcon glyph="image" />
          <span className={styles.cellFallbackName}>{object.name}</span>
        </span>
      ) : (
        // media none(寸法不明)でも正方形セルとして描画する — ratioOf の既定 1 が
        // その形を決め、object-fit: cover がトリミングを担う(design-direction §7)。
        <img className={styles.cellImage} src={getContentUrl(object)} alt="" loading="lazy" decoding="async" draggable={false} onError={handleError} />
      )}
    </GridListItem>
  );
};
