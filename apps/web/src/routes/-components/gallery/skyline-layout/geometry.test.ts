// 出典: task-7-brief.md のリテラル値をそのまま踏襲する。

import { describe, expect, it } from 'vitest';

import { computeSkylineGeometry, visibleRectIds } from './geometry';

// pack 自体の正しさは pack.test.ts が持つ。ここは「cw 単位 → px」の写像だけを固定する。
// 2 列・cw=100。pack の挙動(leftmost-lowest): a(ratio1)→col0 y0 h1、b(ratio2)→col1 y0 h2、
// c(ratio0.5)→col0 y1 h0.5。totalHeight=2。
const items = [
  { id: 'a', ratio: 1, span: 1 },
  { id: 'b', ratio: 2, span: 1 },
  { id: 'c', ratio: 0.5, span: 1 },
];

describe('computeSkylineGeometry', () => {
  it('placements を px 座標に写し、コンテンツ高さは最大列', () => {
    const { rects, totalHeight } = computeSkylineGeometry(items, 2, 100);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(rects.get('b')).toEqual({ x: 100, y: 0, width: 100, height: 200 });
    expect(rects.get('c')).toEqual({ x: 0, y: 100, width: 100, height: 50 });
    expect(totalHeight).toBe(200);
  });

  it('可視 rect と交差する id だけが返る', () => {
    const { rects } = computeSkylineGeometry(items, 2, 100);
    // y=120〜220 の窓: a(0-100)は外、b(0-200)と c(100-150)は交差
    expect(visibleRectIds(rects, { x: 0, y: 120, width: 200, height: 100 }).sort()).toEqual(['b', 'c']);
  });
});
