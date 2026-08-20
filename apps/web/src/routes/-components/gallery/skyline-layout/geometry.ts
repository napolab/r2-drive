import { pack } from '../skyline/pack';

import type { PackItem } from '../skyline/pack';

// Pixel-unit rectangle. Unlike skyline/pack.ts's cw-unit Placement, this is the shape
// react-aria's Layout contract (and its own consumers) expect: absolute px position and
// size, ready to hand to `new Rect(x, y, width, height)`.
export type PxRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

// cw 単位の pack() 結果を px に写す。cw (column width) は呼び出し側が
// `size.width / columns` から計算して渡す — このモジュールはビューポート幅を知らない。
export const computeSkylineGeometry = (items: readonly PackItem[], columns: number, cw: number): { rects: ReadonlyMap<string, PxRect>; totalHeight: number } => {
  const { placements, totalHeight } = pack(items, columns);

  const rects = new Map<string, PxRect>(placements.map((placement) => [placement.id, { x: placement.col * cw, y: placement.y * cw, width: placement.span * cw, height: placement.height * cw }]));

  return { rects, totalHeight: totalHeight * cw };
};

const intersects = (a: PxRect, b: PxRect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// 線形フィルタ(spec §6.3 の判断)。基準 4 の実測で件数が効いてきたら二分探索を再検討する。
export const visibleRectIds = (rects: ReadonlyMap<string, PxRect>, view: PxRect): string[] =>
  Array.from(rects.entries())
    .filter(([, rect]) => intersects(rect, view))
    .map(([id]) => id);
