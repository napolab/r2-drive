import { BucketNotFoundError, NetworkError, ObjectNotFoundError, PreconditionFailedError, R2OperationError, UnauthenticatedError, UploadSessionError } from '@r2-drive/core';
import { hc } from 'hono/client';
import { errAsync, fromPromise } from 'neverthrow';

import type { AppType } from './index';
import type { DriveError, ErrorBody } from '@r2-drive/core';
import type { ClientResponse, InferResponseType } from 'hono/client';
import type { ResultAsync } from 'neverthrow';

// ルート数が 10 を超えると IDE が目に見えて重くなる。型をコンパイル時に固定する。
export type ApiClient = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): ApiClient => hc<AppType>(...args);

// ssr 枝は env / ctx ではなく fetch 関数そのものを受け取る。api(Hono アプリの値)を
// import すると、実行時に参照される switch の分岐であるためツリーシェイクされず、
// このファイルを import しただけでブラウザバンドルに全ルートテーブル・
// @hono/cloudflare-access・mime が引き込まれてしまう。api.fetch(...) の組み立て
// (元リクエストのヘッダ引き継ぎを含む)は、既に api を値として import できる
// apps/web/src/worker.ts 側(またはそこから渡される loader 側)の責務にする。
export type ApiTransport = { readonly kind: 'browser'; readonly origin: string } | { readonly kind: 'ssr'; readonly origin: string; readonly fetch: typeof fetch };

export const createApiClient = (t: ApiTransport): ApiClient => {
  switch (t.kind) {
    case 'browser':
      return hcWithType(t.origin);
    case 'ssr':
      return hcWithType(t.origin, { fetch: t.fetch });
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
// エラー枝: toDriveError は ErrorName の default で throw する(spec 通り、想定外の
// error body を握り潰さないため)。この throw を Promise チェーンの外まで漏らすと
// 「request() は Response → Result の唯一の変換点」という不変条件が壊れる
// (呼び出し側は Result ではなく例外を受け取ることになる)。
// toDriveError の呼び出しを res.json() の .then に置き、fromPromise のエラーマッパで
// 拾えるようにする — throw は Promise の reject に変換されてから拾われる。
// zValidator のバリデーション失敗(`{ success: false, error }`、name を持たない)は
// この経路で到達する既知のケース(uploads の json body バリデーション)。
export const request = <F extends () => Promise<ClientResponse<unknown>>>(send: F): ResultAsync<InferResponseType<F, 200>, DriveError> =>
  fromPromise(send(), (cause) => new NetworkError('request failed', { cause })).andThen((res) =>
    res.ok
      ? fromPromise(res.json() as Promise<InferResponseType<F, 200>>, (cause) => new NetworkError('malformed json', { cause }))
      : fromPromise(
          res.json().then((body) => toDriveError(body as ErrorBody)),
          (cause) => new NetworkError('malformed error body', { cause }),
        ).andThen((error) => errAsync(error)),
  );
