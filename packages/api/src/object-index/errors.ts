// name は instanceof の判別子ではない。判別は instanceof で行う。
// name は log / 表示 / DO の RPC 境界を越えた先の wire 判別子のための安定 ID
// (packages/core/src/errors/index.ts と同じ約束)。
export class BucketMismatchError extends Error {
  override name = 'BucketMismatchError';
  constructor(
    readonly boundBucketId: string,
    readonly receivedBucketId: string,
    options?: { cause?: unknown },
  ) {
    super(`object index is bound to bucket "${boundBucketId}" but received "${receivedBucketId}"`, options);
  }
}

// cursor が今いる経路のものではないときの例外(Ruling 18 / Ruling 23)。
// **両方向で使う。**
//
// - 索引経路が R2 の opaque cursor を受け取った(`object index list` / `object index search`)
// - **R2 経路が索引のタグ付き cursor を受け取った(`r2 list`)。**実測で R2 は不正な
//   cursor を弾かず、空ページ + `truncated: false` を返す。つまり一覧が静かに
//   「ここで終わり」になる(reports/2026-08-18-phase-1-index-perf.md の Ruling 23)
//
// 判定は cursor/index.ts に集約されている。route はどちらの経路が拒否したかを表す
// ラベルで、利用者のキーとは無関係である。
//
// **message に cursor の中身を載せないこと。**cursor は索引では「最後に返した key」
// そのものなので、載せると errors/responder/foreign-cursor が 412 のボディでキーを漏らす。
export class ForeignCursorError extends Error {
  override name = 'ForeignCursorError';
  constructor(
    readonly route: string,
    options?: { cause?: unknown },
  ) {
    super(`cursor does not belong to the ${route} route`, options);
  }
}
