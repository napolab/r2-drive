// 受け入れ基準 1「10,000 オブジェクトのフォルダをスクロールしてもフレーム落ちしない」
// を数字にするための純粋関数。測定(ブラウザ)と判定(ここ)を分けておくと、
// 判定基準だけをテストで固定できる。
//
// 立ち上がりフレームはここでは扱わない。アイドルからの 1 発目が長く出るのは
// 測定条件の問題なので、測定側が「捨てる 1 周目」を先に回して除く。

/** 1 フレームがこの ms を超えたら「引っかかった」とみなす。 */
export const LONG_FRAME_MS = 50;

// 許容する long frame の本数。
//
// 0 を選んだのは「厳しくしたい」からではなく、**実測して 0 で足りると分かったから**である。
// object-list.perf.browser.test.tsx を 3 回連続で回した結果(headless chromium):
//
//   teleport   (viewport 5 枚分/フレーム, 10,000 件を端から端まで) max 32.5 〜 33.4 ms
//   continuous (viewport 1/3 /フレーム, リスト中ほどから 180 フレーム) max 9.3 〜 9.8 ms
//
// 6 verdict すべてで longFrames = 0。閾値 50ms に対して teleport で約 1.5 倍、
// continuous で約 5 倍のマージンがある。
//
// **マージンが薄いのは teleport 側なので、CI が flaky になるならそこから出る。**
// そのときは budget を上げる前に、まず「本当に遅くなったのか」を疑うこと。理由なく
// 赤くなるゲートは数回で信用を失い、本物のデグレごと見逃されるようになる。
// **動かすときは report に実測値を残すこと。**勘で動かすとゲートが意味を失う。
export const LONG_FRAME_BUDGET = 0;

export type FrameVerdict = {
  readonly sampleCount: number;
  /** LONG_FRAME_MS を超えたフレームの本数。 */
  readonly longFrames: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly passed: boolean;
};

/**
 * requestAnimationFrame の delta 列を受け取り、受け入れ基準 1 の合否を出す。
 *
 * 統計は nearest-rank で取る(昇順ソートして index = ceil(p/100 * n) - 1)。
 * サンプルが 0 本のときは統計値をすべて 0 にする。
 */
const percentile = (ascending: readonly number[], ratio: number): number => {
  // nearest-rank。空配列では rank が -1 になるので 0 に倒し、?? で 0 を返す。
  const rank = Math.ceil(ratio * ascending.length) - 1;

  return ascending[Math.max(rank, 0)] ?? 0;
};

export const judgeFrames = (deltas: readonly number[]): FrameVerdict => {
  // sort は破壊的なのでコピーしてから。呼び出し側が持っている計測結果を汚さない。
  const ascending = [...deltas].sort((a, b) => a - b);
  const longFrames = ascending.filter((delta) => delta > LONG_FRAME_MS).length;

  return {
    sampleCount: ascending.length,
    longFrames,
    p50: percentile(ascending, 0.5),
    p95: percentile(ascending, 0.95),
    max: ascending[ascending.length - 1] ?? 0,
    // p95 は記録だけで合否には使わない。分布が悪化しても「引っかかった」と
    // 認識されない限りは基準 1 を満たしている、という立場を取る。
    passed: longFrames <= LONG_FRAME_BUDGET,
  };
};
