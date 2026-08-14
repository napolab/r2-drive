import type { UploadFailureReason } from './index';

// 2xx を絶対に含めないこと。含めた瞬間に成功枝と status が重なり、
// hc 側で res.ok を書いてもエラー body 型が成功枝に漏れ込む。
export type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 412 | 429 | 500 | 503;

// エラークラスから導出できない。override name = '...' はベースの Error.name: string に
// 潰されるため DriveError['name'] はリテラル union にならない。ここで 1 度だけ宣言する。
export type ErrorName = 'BucketNotFoundError' | 'ObjectNotFoundError' | 'UnauthenticatedError' | 'PreconditionFailedError' | 'UploadSessionError' | 'InternalError';

export type ErrorBody =
  | { readonly name: Exclude<ErrorName, 'UploadSessionError'>; readonly message: string }
  | { readonly name: 'UploadSessionError'; readonly message: string; readonly reason: UploadFailureReason };

export type ResponseSpec = { readonly status: ErrorStatusCode; readonly body: ErrorBody };
