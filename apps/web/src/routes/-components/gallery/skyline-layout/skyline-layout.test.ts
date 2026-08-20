import { Rect, Size } from 'react-aria-components';
import { describe, expect, it } from 'vitest';

import { SkylineLayout } from './index';

import type { Collection, Key, Node } from '@react-types/shared';

// Layout を直接インスタンス化して幾何を検証する。Virtualizer 実物は使わない
// (react-aria-components 実物との結合は Task 8/10 の責務)。そのため、Layout が
// `this.virtualizer` から読む最小限(collection / size)だけを満たす fake を用意する。
const createNode = (key: Key, type: string): Node<unknown> => ({
  type,
  key,
  value: null,
  level: 0,
  hasChildNodes: false,
  childNodes: [],
  rendered: null,
  textValue: '',
  index: 0,
});

const createCollection = (nodes: readonly Node<unknown>[]): Collection<Node<unknown>> => {
  const keys = nodes.map((node) => node.key);

  return {
    size: nodes.length,
    getKeys: () => keys,
    getItem: (key) => nodes.find((node) => node.key === key) ?? null,
    at: (idx) => nodes[idx] ?? null,
    getKeyBefore: (key) => {
      const index = keys.indexOf(key);
      return index > 0 ? (keys[index - 1] ?? null) : null;
    },
    getKeyAfter: (key) => {
      const index = keys.indexOf(key);
      return index >= 0 && index < keys.length - 1 ? (keys[index + 1] ?? null) : null;
    },
    getFirstKey: () => keys[0] ?? null,
    getLastKey: () => keys[keys.length - 1] ?? null,
    [Symbol.iterator]: () => nodes[Symbol.iterator](),
  };
};

// react-stately の Virtualizer クラスは private field を持つため、実物を組み立てずに
// 差し込むには unknown 経由のキャストが要る(satisfies は private field 不一致で使えない)。
type FakeVirtualizer = SkylineLayout['virtualizer'];

const createLayout = (nodes: readonly Node<unknown>[], width: number, ratioOf: (key: Key) => number): SkylineLayout => {
  const layout = new SkylineLayout();
  // Virtualizer 実物を回さないので、Layout が読む最小限のフィールドだけを直接差し込む。
  layout.virtualizer = {
    collection: createCollection(nodes),
    size: new Size(width, 0),
    isPersistedKey: () => false,
  } as unknown as FakeVirtualizer;
  layout.update({ layoutOptions: { ratioOf } });

  return layout;
};

describe('SkylineLayout', () => {
  it('2 列に収まる幅では columns=2 として item を配置する', () => {
    const nodes = [createNode('a', 'item'), createNode('b', 'item'), createNode('c', 'item')];
    const ratios: Record<string, number> = { a: 1, b: 2, c: 0.5 };
    const layout = createLayout(nodes, 200, (key) => ratios[`${key}`] ?? 1);

    expect(layout.getLayoutInfo('a')?.rect).toEqual(new Rect(0, 0, 100, 100));
    expect(layout.getLayoutInfo('b')?.rect).toEqual(new Rect(100, 0, 100, 200));
    expect(layout.getLayoutInfo('c')?.rect).toEqual(new Rect(0, 100, 100, 50));
    expect(layout.getContentSize()).toEqual(new Size(200, 200));
  });

  it('幅が広いほど列数が増え、4 列で頭打ちになる(clamp(2,4))', () => {
    const nodes = [createNode('a', 'item')];
    const wide = createLayout(nodes, 4000, () => 1);
    const huge = createLayout(nodes, 40000, () => 1);

    // cw = width / columns。4 列で頭打ちなら cw = width / 4 になる。
    expect(wide.getLayoutInfo('a')?.rect.width).toBeCloseTo(4000 / 4);
    expect(huge.getLayoutInfo('a')?.rect.width).toBeCloseTo(40000 / 4);
  });

  it('未知の key には null を返す', () => {
    const layout = createLayout([createNode('a', 'item')], 200, () => 1);
    expect(layout.getLayoutInfo('missing')).toBeNull();
  });

  it('getVisibleLayoutInfos は交差する item だけを返す', () => {
    const nodes = [createNode('a', 'item'), createNode('b', 'item'), createNode('c', 'item')];
    const ratios: Record<string, number> = { a: 1, b: 2, c: 0.5 };
    const layout = createLayout(nodes, 200, (key) => ratios[`${key}`] ?? 1);

    const visible = layout.getVisibleLayoutInfos(new Rect(0, 120, 200, 100));
    expect(visible.map((info) => info.key).sort()).toEqual(['b', 'c']);
  });

  it('末尾が loader ノードなら totalHeight 直下に配置し、常に可視に含める', () => {
    const nodes = [createNode('a', 'item'), createNode('loader-sentinel', 'loader')];
    const layout = createLayout(nodes, 200, () => 1);

    const loaderInfo = layout.getLayoutInfo('loader-sentinel');
    expect(loaderInfo?.type).toBe('loader');
    expect(loaderInfo?.rect.y).toBe(100); // totalHeight(cw=1) = 1 * cw(100) = 100
    expect(loaderInfo?.rect.height).toBeGreaterThan(0);

    // ビューポート外(はるか上)を問い合わせても loader は必ず含まれる
    const visible = layout.getVisibleLayoutInfos(new Rect(0, -1000, 200, 10));
    expect(visible.some((info) => info.key === 'loader-sentinel')).toBe(true);

    // コンテンツ高さは item の totalHeight + loader の高さを含む
    expect(layout.getContentSize().height).toBeGreaterThan(100);
  });
});
