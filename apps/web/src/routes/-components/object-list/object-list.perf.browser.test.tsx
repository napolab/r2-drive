// 受け入れ基準 1「10,000 オブジェクトのフォルダをスクロールしてもフレーム落ちしない」の
// **描画コストだけ**を切り出して測る。ネットワークもデータ取得も入れない。
//
// 計測は 2 条件で行う。teleport は 1 フレームで viewport の数倍を飛ばし、可視タイルが
// 毎フレーム全入れ替わる最悪条件のストレステスト。continuous はステップを viewport の
// 1/3 に固定し、前フレームのタイルが大半再利用される「人間が 1 回フリックした」条件を
// 再現する。コストの性質が違うので、片方だけでは受け入れ基準の裏取りにならない。
//
// headless Chromium の requestAnimationFrame は実ディスプレイの vsync と切り離されて
// 回るため、ここで出る数字は絶対値ではなく「同条件での相対値」として扱うこと。
// 体感の裏取りは実アプリを開いて DevTools の performance trace で行う。

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { judgeFrames } from './frame-budget/index';
import { ObjectList } from './index';

import type { FrameVerdict } from './frame-budget/index';
import type { ObjectDescriptor } from '@r2-drive/core';

const noop = () => undefined;

// 呼ばれない前提(opaque preview は inline SVG のアイコンだけ)。万一呼ばれても
// ネットワークに出ないよう空の data URL を返す。
const getContentUrl = (): string => 'data:,';

const OBJECT_COUNT = 10_000;

// teleport: 1 パスを 3〜5 秒に収めるための目標フレーム数。60fps 換算で約 3 秒。
const TELEPORT_TARGET_FRAMES = 180;
// 実測フレームが目標より短くなっても端に着けば止まる。逆に着かない場合の安全弁。
const TELEPORT_MAX_FRAMES = 400;
// continuous: 端まで行く必要はないのでフレーム数で打ち切る。
const CONTINUOUS_FRAMES = 180;
// 先頭付近はウォームアップで温まっていて条件が甘い。中ほどから助走なしで始める。
const CONTINUOUS_START_RATIO = 0.4;

// 実アプリの lineClamp: 2 の折り返しコストを再現するため、長短を混ぜる。
const buildName = (index: number): string => {
  switch (index % 4) {
    case 0:
      return `a-${index}.bin`;
    case 1:
      return `capture-${index}.bin`;
    case 2:
      return `スクリーンショット-とても長いファイル名-2026-08-14-${index}.bin`;
    default:
      return `archive-of-something-quite-long-and-wrapping-${index}.bin`;
  }
};

// contentType: application/octet-stream + .bin 拡張子。markdown(拡張子 / text/markdown)、
// image / video / audio(contentType の prefix)のどれにも当たらないので
// resolveFileType は opaque に落ちる = preview は inline SVG のみでネットワークが出ない。
const buildObject = (index: number): ObjectDescriptor => ({
  bucketId: 'photos',
  key: `perf/${index}.bin`,
  name: buildName(index),
  contentType: 'application/octet-stream',
  size: 1024 + index,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: `etag-${index}`,
});

const objects: readonly ObjectDescriptor[] = Array.from({ length: OBJECT_COUNT }, (_unused, index) => buildObject(index));

type ScrollPass = {
  readonly deltas: readonly number[];
  readonly durationMs: number;
  readonly step: number;
  readonly startedFrom: number;
  readonly distance: number;
};

const maxScrollTop = (scroller: HTMLElement): number => scroller.scrollHeight - scroller.clientHeight;

const stepBy = (scroller: HTMLElement, step: number): void => {
  const remaining = maxScrollTop(scroller) - scroller.scrollTop;
  scroller.scrollTop = scroller.scrollTop + Math.min(step, remaining);
};

const nextFrame = (): Promise<void> => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// 計測の開始位置へ飛ぶ。ジャンプそのものの描画コストを計測パスの 1 本目の delta に
// 混ぜないよう、2 フレーム空けて仮想化の再測定を落ち着かせてから戻る。
const seekTo = async (scroller: HTMLElement, top: number): Promise<void> => {
  scroller.scrollTop = top;
  await nextFrame();
  await nextFrame();
};

// rAF が渡してくる timestamp を使う。performance.now() を自前で呼ぶより実際の
// フレーム境界に近い。let を持たないよう、次フレームのコールバックを
// (前回 timestamp, これまでの delta 列) で作り直して再帰させる。
// 現在の scrollTop から始め、末尾に着くか maxFrames に達したら止まる。
const runScrollPass = (scroller: HTMLElement, step: number, maxFrames: number): Promise<ScrollPass> =>
  new Promise<ScrollPass>((resolve) => {
    const startedAt = performance.now();
    const startedFrom = scroller.scrollTop;
    const advance = (previous: number, deltas: readonly number[]) => (timestamp: number) => {
      const collected = [...deltas, timestamp - previous];
      const remaining = maxScrollTop(scroller) - scroller.scrollTop;
      if (remaining <= 1 || collected.length >= maxFrames) {
        resolve({
          deltas: collected,
          durationMs: performance.now() - startedAt,
          step,
          startedFrom,
          distance: scroller.scrollTop - startedFrom,
        });

        return;
      }
      stepBy(scroller, step);
      requestAnimationFrame(advance(timestamp, collected));
    };
    requestAnimationFrame((first) => {
      stepBy(scroller, step);
      requestAnimationFrame(advance(first, []));
    });
  });

// teleport のステップ幅。総距離が大きいときは 1 パスの長さを TELEPORT_TARGET_FRAMES に
// 寄せる。clientHeight / 3 は総距離が短いリストでも刻みすぎないための下限。
const resolveTeleportStep = (scroller: HTMLElement): number => Math.max(Math.round(scroller.clientHeight / 3), Math.ceil(maxScrollTop(scroller) / TELEPORT_TARGET_FRAMES));

const logPass = (label: string, pass: ScrollPass, verdict: FrameVerdict): void => {
  console.log(`[perf] ${label} step=${pass.step} frames=${pass.deltas.length} from=${Math.round(pass.startedFrom)} distance=${Math.round(pass.distance)} duration=${pass.durationMs.toFixed(1)} ms`);
  console.log(
    `[perf] ${label} verdict sampleCount=${verdict.sampleCount} longFrames=${verdict.longFrames} p50=${verdict.p50.toFixed(2)} p95=${verdict.p95.toFixed(2)} max=${verdict.max.toFixed(2)} passed=${verdict.passed}`,
  );
};

it('10,000 オブジェクトを teleport / continuous のどちらでスクロールしてもフレーム落ちしない', async () => {
  const host = document.createElement('div');
  host.style.width = '800px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    // 10,000 件の Collection 構築は O(n) で、1 ページ 200 件ずつ積み上がる実アプリでは
    // 起きない条件。スクロールのフレーム時間に混ぜず、別の数字として記録だけする。
    const mountStartedAt = performance.now();
    flushSync(() => {
      root.render(
        <ObjectList
          folders={[]}
          objects={objects}
          getContentUrl={getContentUrl}
          selectedKeys={new Set()}
          onSelectionChange={noop}
          onDeleteRequest={noop}
          onObjectContextMenu={noop}
          onOpenFolder={noop}
          onPrefetchFolder={noop}
          onOpenObject={noop}
          onExternalFiles={noop}
          onExternalFileError={noop}
          onLoadMore={noop}
          isLoadingMore={false}
        />,
      );
    });
    const mountMs = performance.now() - mountStartedAt;
    console.log(`[perf] mount(${OBJECT_COUNT} objects) = ${mountMs.toFixed(1)} ms`);

    await expect.poll(() => host.querySelectorAll('[data-kind="object"]').length, { timeout: 60_000 }).toBeGreaterThan(0);

    const scroller = host.querySelector('[aria-label="オブジェクト一覧"]');
    if (!(scroller instanceof HTMLElement)) throw new Error('スクロールコンテナ(role=grid)が描画されなかった');
    if (maxScrollTop(scroller) <= 0) throw new Error('スクロールできる高さが無い(仮想化の測定が走っていない可能性)');

    const teleportStep = resolveTeleportStep(scroller);
    const continuousStep = Math.round(scroller.clientHeight / 3);
    console.log(
      `[perf] visibleTiles=${host.querySelectorAll('[data-kind="object"]').length} scrollHeight=${scroller.scrollHeight} clientHeight=${scroller.clientHeight} teleportStep=${teleportStep} continuousStep=${continuousStep}`,
    );

    // 1 周目は捨てる。アイドルからの 1 発目は必ず長く出るため。
    await seekTo(scroller, 0);
    const warmup = await runScrollPass(scroller, teleportStep, TELEPORT_MAX_FRAMES);
    console.log(`[perf] warmup(discarded) frames=${warmup.deltas.length} distance=${Math.round(warmup.distance)} duration=${warmup.durationMs.toFixed(1)} ms`);

    // 1. teleport — 端から端まで。可視タイルが毎フレーム全入れ替わる最悪条件。
    await seekTo(scroller, 0);
    const teleport = await runScrollPass(scroller, teleportStep, TELEPORT_MAX_FRAMES);
    const teleportVerdict = judgeFrames(teleport.deltas);
    logPass('teleport', teleport, teleportVerdict);

    // 2. continuous — viewport の 1/3 刻みでフレーム数打ち切り。人間の 1 フリック相当。
    await seekTo(scroller, scroller.scrollHeight * CONTINUOUS_START_RATIO);
    const continuous = await runScrollPass(scroller, continuousStep, CONTINUOUS_FRAMES);
    const continuousVerdict = judgeFrames(continuous.deltas);
    logPass('continuous', continuous, continuousVerdict);

    expect(teleportVerdict.passed).toBe(true);
    expect(continuousVerdict.passed).toBe(true);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}, 180_000);
