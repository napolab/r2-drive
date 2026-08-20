import { expect } from 'vitest';

import type { ObjectIndexUnderTest } from './worker-entry';

// バックフィルが終端(complete / failed)に着くまで待つ。
//
// cloudflare:test は runDurableObjectAlarm(stub)(予約済みの alarm を即座に消費する)を
// 持っているが、**この環境では決定性の足しにならない。**実測(2026-08-18、miniflare 上):
//
//   - startBackfill が setAlarm(Date.now()) した alarm は workerd が自動発火する。
//     1001 件 = 2 ページのバックフィルは runDurableObjectAlarm を一度も呼ばなくても
//     complete まで自走した。
//   - 逆に runDurableObjectAlarm を呼ぶと、自動発火と競合して false(= 予約が無い)を
//     返したり、1 回の呼び出しの裏で 2 ページ分進んだりする。
//
// つまり「1 ページずつ手で回して途中経過を観測する」は、この環境では原理的に
// 決定的にならない。よって終端状態をポーリングして待つ。
//
// timeout は「カーソルを保存しない」変異の検出上限でもある。その変異では毎回先頭
// ページを舐め直して truncated のまま次の alarm を予約し続けるので、running から
// 永久に抜けずここで落ちる。個別のテストが timeout を延ばしていなければ vitest 既定の
// 5s が先に落とすが、どちらでも変異は検出できる。
//
// Task 5: 索引フェーズの complete は media 追い掛けフェーズの入口にすぎない
// (#indexPage が complete を書いた直後、mediaPending > 0 なら続けて alarm を予約する)。
// 索引フェーズの complete だけを見て抜けると、mediaPending が残ったまま後続のアサーション
// が走ってしまう。よって「running」または「complete かつ mediaPending が残っている」間は
// 待ち続ける。failed / idle は待たずに抜ける(従来どおり、回復不能な状態で無限に待たせない)。
export const waitForBackfill = async (stub: DurableObjectStub<ObjectIndexUnderTest>): Promise<void> => {
  await expect
    .poll(
      async () => {
        const status = await stub.status();

        return status.kind === 'running' || (status.kind === 'complete' && status.mediaPending > 0);
      },
      { timeout: 20_000 },
    )
    .toBe(false);
};
