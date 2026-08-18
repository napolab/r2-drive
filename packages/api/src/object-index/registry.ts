import { BucketNotFoundError, R2OperationError } from '@r2-drive/core';
import { err, ok, ResultAsync } from 'neverthrow';

import { bucketDescriptors } from '../r2/registry';

import type { ObjectIndex } from './index';
import type { DriveError, ObjectDescriptor } from '@r2-drive/core';
import type { Result } from 'neverthrow';

// 1 バケット = 1 DO。idFromName に bucketId をそのまま渡すので、
// バケットを足しても DO 側の設定は増えない。
//
// Env.OBJECT_INDEX は DurableObjectNamespace<ObjectIndex> に解決される。apps/web/src/worker.ts
// が ObjectIndex を再輸出したことで wrangler types が実クラスを引けるようになったため
// (Task 10)、Task 1 から引きずっていたキャストはここから消えている。
export const resolveObjectIndex = (env: Env, id: string): Result<DurableObjectStub<ObjectIndex>, BucketNotFoundError> => {
  const descriptor = bucketDescriptors.find((d) => d.id === id);
  if (descriptor === undefined) return err(new BucketNotFoundError(id));

  return ok(env.OBJECT_INDEX.get(env.OBJECT_INDEX.idFromName(descriptor.id)));
};

// 索引を担当するバケットかどうか。deploy 時の設定なので同期で判定できる。
// bucketDescriptors は `as const satisfies` で全要素が indexed: false のリテラル型に
// 固定されているため、`=== true` は現時点で常に false と評価され tsgo が
// 到達不能な比較として弾く(TS2367)。`?? false` なら、将来 indexed: true の要素が
// 増えて union が広がっても書き換え不要。
export const isIndexed = (id: string): boolean => bucketDescriptors.find((d) => d.id === id)?.indexed ?? false;

// indexed かどうかに関わらず書く。索引を後から有効化するとき、
// 「有効化前にアップロードされた分が抜けている」を防ぐため
// (抜けるとバックフィルをやり直す必要が出る)。
export const indexUpsert = (env: Env, object: ObjectDescriptor): ResultAsync<void, DriveError> =>
  resolveObjectIndex(env, object.bucketId).asyncAndThen((stub) => ResultAsync.fromPromise(stub.upsert(object), (cause) => new R2OperationError(`index upsert failed: ${object.key}`, { cause })));

export const indexRemove = (env: Env, bucketId: string, key: string): ResultAsync<void, DriveError> =>
  resolveObjectIndex(env, bucketId).asyncAndThen((stub) => ResultAsync.fromPromise(stub.remove(key), (cause) => new R2OperationError(`index remove failed: ${key}`, { cause })));
