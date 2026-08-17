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
