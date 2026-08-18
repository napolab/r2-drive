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

// 索引が発行していない cursor(= 別経路の cursor)を受け取ったときの例外(Ruling 18)。
// cursor/index.ts のタグ判定だけがこれを投げる。
//
// message に cursor の中身を載せないこと。cursor は「最後に返した key」なので、
// 載せると errors/responder/foreign-cursor が 400 のボディでキーを漏らす。
// route は 'list' / 'search' のどちらの経路が拒否したかで、利用者のキーとは無関係。
export class ForeignCursorError extends Error {
  override name = 'ForeignCursorError';
  constructor(
    readonly route: string,
    options?: { cause?: unknown },
  ) {
    super(`cursor was not issued by the object index ${route} route`, options);
  }
}
