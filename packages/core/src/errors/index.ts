// name は instanceof の判別子ではない。判別は instanceof で行う。
// name は log / 表示 / JSON を越えた先の wire 判別子のための安定 ID。
export class BucketNotFoundError extends Error {
  override name = 'BucketNotFoundError';
}
export class ObjectNotFoundError extends Error {
  override name = 'ObjectNotFoundError';
}
export class UnauthenticatedError extends Error {
  override name = 'UnauthenticatedError';
}
export class PreconditionFailedError extends Error {
  override name = 'PreconditionFailedError';
}
export class R2OperationError extends Error {
  override name = 'R2OperationError';
}
export class NetworkError extends Error {
  override name = 'NetworkError';
}

export type UploadFailureReason = 'part-too-small' | 'too-many-parts' | 'unknown-upload-id' | 'aborted';

export class UploadSessionError extends Error {
  override name = 'UploadSessionError';
  constructor(
    readonly reason: UploadFailureReason,
    options?: { cause?: unknown },
  ) {
    super(`upload session failed: ${reason}`, options);
  }
}

export type DriveError = BucketNotFoundError | ObjectNotFoundError | UnauthenticatedError | PreconditionFailedError | UploadSessionError | R2OperationError | NetworkError;
