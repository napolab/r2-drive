import { R2OperationError } from '@r2-drive/core';
import { fromPromise } from 'neverthrow';
import mime from 'mime';

import type { DriveError, ObjectPage, Prefix } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

const PAGE_SIZE = 200;

const nameOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

// R2 の httpMetadata が空のときは拡張子から確定させる。contentType を optional にしない。
const contentTypeOf = (key: string, meta: R2HTTPMetadata | undefined): string => meta?.contentType ?? mime.getType(key) ?? 'application/octet-stream';

export type ListInput = { readonly bucket: R2Bucket; readonly bucketId: string; readonly prefix: Prefix; readonly cursor: string | undefined };

// exactOptionalPropertyTypes 下では cursor: undefined を明示的に渡せない。
// キー自体を作るかどうかで分岐する。
const listOptionsOf = (input: ListInput): R2ListOptions =>
  input.cursor === undefined
    ? { prefix: input.prefix, delimiter: '/', limit: PAGE_SIZE, include: ['httpMetadata'] }
    : { prefix: input.prefix, delimiter: '/', limit: PAGE_SIZE, include: ['httpMetadata'], cursor: input.cursor };

export const listObjects = (input: ListInput): ResultAsync<ObjectPage, DriveError> =>
  fromPromise(input.bucket.list(listOptionsOf(input)), (cause) => new R2OperationError(`list failed: ${input.prefix}`, { cause })).map((listed) => ({
    // delimitedPrefixes が「フォルダ」の正体。ディレクトリという実体は R2 に無い。
    folders: listed.delimitedPrefixes.map((prefix) => ({ bucketId: input.bucketId, prefix, name: nameOf(prefix.slice(0, -1)) })),
    objects: listed.objects
      // prefix そのものを表す 0 バイトのマーカーは一覧に出さない
      .filter((object) => object.key !== input.prefix)
      .map((object) => ({
        bucketId: input.bucketId,
        key: object.key,
        name: nameOf(object.key),
        contentType: contentTypeOf(object.key, object.httpMetadata),
        size: object.size,
        uploadedAt: object.uploaded.toISOString(),
        etag: object.httpEtag,
      })),
    next: listed.truncated ? { kind: 'more', cursor: listed.cursor } : { kind: 'end' },
  }));
