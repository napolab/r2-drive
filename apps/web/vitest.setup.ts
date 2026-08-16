// jsdom は IntersectionObserver を実装していない。react-aria の
// useLoadMoreSentinel(GridListLoadMoreItem の中身)がマウント時に必ず new するため、
// 無いとレンダリング自体が落ちる。
//
// 可視判定は jsdom では要素の実サイズが 0 になるので、どのみち意味を成さない。
// 「次ページを実際に取りに行くか」は開発サーバー / Task 16 の実測で確認する。
// ここでは observe / unobserve を no-op にした最小のスタブだけを置く。
const IntersectionObserverStub = class implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
};

globalThis.IntersectionObserver = IntersectionObserverStub;
