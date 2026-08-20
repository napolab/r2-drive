import { Layout, LayoutInfo, Rect, Size } from 'react-aria-components';

import { computeSkylineGeometry, visibleRectIds } from './geometry';

import type { PxRect } from './geometry';
import type { Key, Node } from '@react-types/shared';
import type { InvalidationContext } from 'react-stately/useVirtualizerState';

// GridLayout の minItemSize と同じ発想 — ビューポート幅から列数を決める。skyline は
// 列単位(cw)でパックするので、こちらは「最小列幅」だけを持つ。
const MIN_COLUMN_PX = 240;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 4;
// GridLayout の既定 loaderHeight(48px)に倣う。load-more センチネルはビューポート幅
// いっぱいの帯として totalHeight の直下に配置する。
const LOADER_HEIGHT_PX = 48;

export type SkylineLayoutOptions = { readonly ratioOf: (key: Key) => number };

const resolveColumns = (width: number): number => Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.floor(width / MIN_COLUMN_PX)));

const keyToId = (key: Key): string => `${key}`;

const toRect = (rect: PxRect): Rect => new Rect(rect.x, rect.y, rect.width, rect.height);

/**
 * skyline/pack.ts の cw 単位パッキングを react-aria の Virtualizer Layout 契約に橋渡しする。
 * 幾何計算そのものは geometry.ts(computeSkylineGeometry / visibleRectIds)に寄せてあり、
 * このクラスはコレクション列挙・キャッシュ・LayoutInfo への詰め替えだけを担う薄い層。
 *
 * キーボードナビゲーションは既定 delegate(LayoutInfo の矩形ベース)に任せる。skyline の
 * 「真下」が不自然な場合の getKeyBelow 上書きは Task 10 のブラウザ検証後に判断する(YAGNI)。
 */
export class SkylineLayout extends Layout<Node<unknown>, SkylineLayoutOptions> {
  #rects: ReadonlyMap<string, PxRect> = new Map();
  #layoutInfos: ReadonlyMap<Key, LayoutInfo> = new Map();
  #contentSize: Size = new Size();

  override shouldInvalidateLayoutOptions(newOptions: SkylineLayoutOptions, oldOptions: SkylineLayoutOptions): boolean {
    return newOptions.ratioOf !== oldOptions.ratioOf;
  }

  override update(invalidationContext: InvalidationContext<SkylineLayoutOptions>): void {
    const virtualizer = this.virtualizer;
    if (virtualizer === null) return;

    const ratioOf = invalidationContext.layoutOptions?.ratioOf;
    if (ratioOf === undefined) return;

    const { collection, size } = virtualizer;
    const nonLoaderNodes = Array.from(collection).filter((node) => node.type !== 'loader');
    const lastKey = collection.getLastKey();
    const lastNode = lastKey === null ? null : collection.getItem(lastKey);
    const loaderNode = lastNode !== null && lastNode.type === 'loader' ? lastNode : null;

    const items = nonLoaderNodes.map((node) => ({ id: keyToId(node.key), ratio: ratioOf(node.key), span: 1 }));
    const columns = resolveColumns(size.width);
    const cw = size.width / columns;
    const { rects, totalHeight } = computeSkylineGeometry(items, columns, cw);
    const loaderHeight = loaderNode === null ? 0 : LOADER_HEIGHT_PX;

    const itemLayoutInfos: [Key, LayoutInfo][] = nonLoaderNodes.flatMap((node) => {
      const rect = rects.get(keyToId(node.key));
      if (rect === undefined) return [];

      return [[node.key, new LayoutInfo('item', node.key, toRect(rect))]];
    });

    const loaderLayoutInfos: [Key, LayoutInfo][] = loaderNode === null ? [] : [[loaderNode.key, new LayoutInfo('loader', loaderNode.key, new Rect(0, totalHeight, size.width, loaderHeight))]];

    this.#rects = rects;
    this.#layoutInfos = new Map([...itemLayoutInfos, ...loaderLayoutInfos]);
    this.#contentSize = new Size(size.width, totalHeight + loaderHeight);
  }

  override getLayoutInfo(key: Key): LayoutInfo | null {
    return this.#layoutInfos.get(key) ?? null;
  }

  override getContentSize(): Size {
    return this.#contentSize;
  }

  override getVisibleLayoutInfos(rect: Rect): LayoutInfo[] {
    const view: PxRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const visibleIds = new Set(visibleRectIds(this.#rects, view));
    const virtualizer = this.virtualizer;

    return Array.from(this.#layoutInfos.values()).filter((info) => info.type === 'loader' || visibleIds.has(keyToId(info.key)) || (virtualizer?.isPersistedKey(info.key) ?? false));
  }
}
