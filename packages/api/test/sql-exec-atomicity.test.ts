import { expect, it } from 'vitest';

import { objectIndexNamespace } from './object-index-namespace';

// spec §12 のリスク 2。
//
// 記録する事実(2026-08-17、miniflare 上で実測): 連続した sql.exec は、失敗した文の
// 直前までをロールバックしない。これは失敗が prepare 段階か実行時かに依存せず、
// 例外を捕まえるかどうかにも依存しない。原子性が必要なら transactionSync(または
// それに委譲する Drizzle の db.transaction())で明示的に囲う。
//
// 「Cloudflare の言う write coalescing が存在しない」という意味ではない。
// write coalescing は耐久性のバッチング(output gate)の話であり、
// 「文が失敗したら直前まで巻き戻る」という原子性は元々そこに含まれていない。
//
// debugSetupAtomicityProbe() は測定対象とは別の RPC 呼び出しに出している。CREATE / DELETE /
// seed の INSERT が測定対象の 2 文と同じ暗黙トランザクションに紛れ込むと、
// 「原子的だから 0 行」と「probe 自体が壊れて CREATE ごと巻き戻り例外になった」を
// 区別できなくなるため。
it('debugProbeAtomicityWithoutTransaction: 先行する INSERT は失敗後もロールバックされずに残る', async () => {
  const stub = objectIndexNamespace.get(objectIndexNamespace.idFromName('sql-exec-atomicity-without-tx'));
  await stub.debugSetupAtomicityProbe();

  // seed(1 行)+ first(1 行、ロールバックされずに残る)= 2 行。
  await expect(stub.debugProbeAtomicityWithoutTransaction()).resolves.toBe(2);
});

// 対照実験(positive control)。巻き戻り機構自体がこの環境で動くことを示す。
// これが無いと「1 本目が残った」だけでは「巻き戻り機構が壊れている」のか
// 「機構はあるがこの経路では効かない」のかを判別できない。
it('debugProbeAtomicityWithTransactionSync: transactionSync で囲うと先行する INSERT がロールバックされる', async () => {
  const stub = objectIndexNamespace.get(objectIndexNamespace.idFromName('sql-exec-atomicity-with-tx'));
  await stub.debugSetupAtomicityProbe();

  // seed(1 行)のみ。first は transactionSync のロールバックで消える。
  await expect(stub.debugProbeAtomicityWithTransactionSync()).resolves.toBe(1);
});
