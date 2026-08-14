import { BucketNotFoundError, NetworkError, ObjectNotFoundError, PreconditionFailedError, R2OperationError, UnauthenticatedError, UploadSessionError } from '@r2-drive/core';
import { hc } from 'hono/client';
import { errAsync, fromPromise } from 'neverthrow';

import { api } from './index';

import type { AppType } from './index';
import type { DriveError, ErrorBody } from '@r2-drive/core';
import type { ClientResponse, InferResponseType } from 'hono/client';
import type { ResultAsync } from 'neverthrow';

// ルート数が 10 を超えると IDE が目に見えて重くなる。型をコンパイル時に固定する。
export type ApiClient = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): ApiClient => hc<AppType>(...args);

export type ApiTransport =
  | { readonly kind: 'browser'; readonly origin: string }
  | { readonly kind: 'ssr'; readonly origin: string; readonly env: Env; readonly ctx: ExecutionContext; readonly headers: Headers };

const mergeHeaders = (base: Headers, extra: HeadersInit | undefined): Headers => {
  const merged = new Headers(base);
  new Headers(extra).forEach((value, key) => merged.set(key, value));

  return merged;
};

export const createApiClient = (t: ApiTransport): ApiClient => {
  switch (t.kind) {
    case 'browser':
      return hcWithType(t.origin);
    case 'ssr':
      // 同一アイソレート内の関数呼び出し。エッジにもアセットレイヤにも Access にも触れない。
      // 元リクエストのヘッダを引き継がないと自分の認証ミドルウェアに弾かれる。
      return hcWithType(t.origin, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => api.fetch(new Request(input, { ...init, headers: mergeHeaders(t.headers, init?.headers) }), t.env, t.ctx),
      });
    default: {
      const _exhaustive: never = t;
      throw new Error(`unhandled transport: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// instanceof はプロセス境界を越えない。wire の name からクラスを復元する。
export const toDriveError = (body: ErrorBody): DriveError => {
  switch (body.name) {
    case 'BucketNotFoundError':
      return new BucketNotFoundError(body.message);
    case 'ObjectNotFoundError':
      return new ObjectNotFoundError(body.message);
    case 'UnauthenticatedError':
      return new UnauthenticatedError(body.message);
    case 'PreconditionFailedError':
      return new PreconditionFailedError(body.message);
    case 'UploadSessionError':
      return new UploadSessionError(body.reason);
    case 'InternalError':
      return new R2OperationError(body.message);
    default: {
      const _exhaustive: never = body;
      throw new Error(`unhandled error body: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Response → Result の唯一の変換点。他の場所では書かない。
//
// 素朴に `<T>(send: () => Promise<ClientResponse<T>>)` と書くと、hc が実際に返す型
// `Promise<ClientResponse<成功body,200,'json'> | ClientResponse<ErrorBody,ErrorStatusCode,'json'>>`
// (union) から T を推論する際に TypeScript が union の片方の分岐だけを拾ってしまう
// (既知の推論限界。tsgo と tsc 6.0.2 の両方で再現し、拾われる分岐すら一致しなかった)。
// send 自体の関数型 F を型引数に取り、Hono 公式の `InferResponseType<F, 200>` で
// 成功 body の型を導出することで、推論を Hono の型ユーティリティ側に委ねる。
export const request = <F extends () => Promise<ClientResponse<unknown>>>(send: F): ResultAsync<InferResponseType<F, 200>, DriveError> =>
  fromPromise(send(), (cause) => new NetworkError('request failed', { cause })).andThen((res) =>
    res.ok
      ? fromPromise(res.json() as Promise<InferResponseType<F, 200>>, (cause) => new NetworkError('malformed json', { cause }))
      : fromPromise(res.json() as Promise<ErrorBody>, (cause) => new NetworkError('malformed error body', { cause })).andThen((body) => errAsync(toDriveError(body))),
  );
