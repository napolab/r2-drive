import { describe, expect, it } from 'vitest';

import { judgeFrames, LONG_FRAME_BUDGET, LONG_FRAME_MS } from './index';

// 16ms を 18 本 + 60ms + 120ms = 20 サンプル。
// 昇順ソートすると [16 × 18, 60, 120]。
// p50 -> ceil(0.50 * 20) - 1 = 9  -> 16
// p95 -> ceil(0.95 * 20) - 1 = 18 -> 60
const SAMPLES: readonly number[] = [16, 16, 16, 16, 16, 16, 16, 16, 16, 60, 16, 16, 16, 16, 16, 120, 16, 16, 16, 16];

describe('judgeFrames', () => {
  it('サンプル数と nearest-rank のパーセンタイルと最大値を出す', () => {
    const verdict = judgeFrames(SAMPLES);

    expect(verdict.sampleCount).toBe(20);
    expect(verdict.p50).toBe(16);
    expect(verdict.p95).toBe(60);
    expect(verdict.max).toBe(120);
  });

  it('入力の順序に影響されない', () => {
    const reversed = [...SAMPLES].reverse();

    expect(judgeFrames(reversed).p50).toBe(judgeFrames(SAMPLES).p50);
    expect(judgeFrames(reversed).p95).toBe(judgeFrames(SAMPLES).p95);
    expect(judgeFrames(reversed).max).toBe(judgeFrames(SAMPLES).max);
  });

  it('LONG_FRAME_MS を超えたフレームだけを long として数える', () => {
    expect(judgeFrames(SAMPLES).longFrames).toBe(2);
  });

  it('閾値ちょうどのフレームは long として数えない', () => {
    expect(judgeFrames([LONG_FRAME_MS, LONG_FRAME_MS, LONG_FRAME_MS]).longFrames).toBe(0);
    expect(judgeFrames([LONG_FRAME_MS + 1]).longFrames).toBe(1);
  });

  it('サンプルが 0 本でも例外を投げず、統計値は 0 になる', () => {
    const verdict = judgeFrames([]);

    expect(verdict.sampleCount).toBe(0);
    expect(verdict.longFrames).toBe(0);
    expect(verdict.p50).toBe(0);
    expect(verdict.p95).toBe(0);
    expect(verdict.max).toBe(0);
  });

  it('サンプルが 1 本のときは p50 / p95 / max がその値になる', () => {
    const verdict = judgeFrames([33]);

    expect(verdict.sampleCount).toBe(1);
    expect(verdict.p50).toBe(33);
    expect(verdict.p95).toBe(33);
    expect(verdict.max).toBe(33);
  });

  // passed の方針。閾値そのものは LONG_FRAME_BUDGET が持つので、テストは
  // 定数を参照して書く。budget を動かしてもこの 3 本の意味は変わらない。
  it('long frame が 1 本も無いスクロールを passed にする', () => {
    expect(judgeFrames([16, 17, 16, 16, 33, 16]).passed).toBe(true);
  });

  it('LONG_FRAME_BUDGET までの long frame は passed のままにする', () => {
    const tolerated = Array.from({ length: LONG_FRAME_BUDGET }, () => LONG_FRAME_MS + 10);

    expect(judgeFrames([16, 16, 16, ...tolerated]).passed).toBe(true);
  });

  it('LONG_FRAME_BUDGET を 1 本でも超えたら passed = false にする', () => {
    const overBudget = Array.from({ length: LONG_FRAME_BUDGET + 1 }, () => LONG_FRAME_MS + 10);

    expect(judgeFrames([16, 16, 16, ...overBudget]).passed).toBe(false);
  });

  it('p95 が悪化していても long frame が無ければ passed のままにする', () => {
    const verdict = judgeFrames([16, 16, 40, 45, 48, 49]);

    expect(verdict.p95).toBe(49);
    expect(verdict.passed).toBe(true);
  });
});
