import { BucketNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import { bucketDescriptors } from '../r2/registry';

import type { ObjectIndex } from './index';
import type { Result } from 'neverthrow';

// apps/web/src/worker.ts は ObjectIndex を値として import していない(spec §11.3、
// @r2-drive/api を import してよいのは worker.ts だけという制約とは別に、DO クラスの
// 実体は wrangler.jsonc の class_name 経由でしか結び付いていない)。そのため
// wrangler types が生成する Env.OBJECT_INDEX は DurableObjectNamespace<undefined> にしか
// 解決できず、.get() の戻り値も DurableObjectStub<undefined> になる。Task 10 で worker.ts
// から ObjectIndex を export すれば cf-typegen の再生成だけで <ObjectIndex> に解決される
// (テスト側は test/object-index-namespace.ts が同じ理由で 1 箇所にキャストを集約している)。
// それまではここ 1 箇所にキャストを閉じる。
const objectIndexNamespace = (env: Env): DurableObjectNamespace<ObjectIndex> => env.OBJECT_INDEX as DurableObjectNamespace<ObjectIndex>;

// 1 バケット = 1 DO。idFromName に bucketId をそのまま渡すので、
// バケットを足しても DO 側の設定は増えない。
export const resolveObjectIndex = (env: Env, id: string): Result<DurableObjectStub<ObjectIndex>, BucketNotFoundError> => {
  const descriptor = bucketDescriptors.find((d) => d.id === id);
  if (descriptor === undefined) return err(new BucketNotFoundError(id));

  const namespace = objectIndexNamespace(env);

  return ok(namespace.get(namespace.idFromName(descriptor.id)));
};

// 索引を担当するバケットかどうか。deploy 時の設定なので同期で判定できる。
// bucketDescriptors は `as const satisfies` で全要素が indexed: false のリテラル型に
// 固定されているため、`=== true` は現時点で常に false と評価され tsgo が
// 到達不能な比較として弾く(TS2367)。`?? false` なら、将来 indexed: true の要素が
// 増えて union が広がっても書き換え不要。
export const isIndexed = (id: string): boolean => bucketDescriptors.find((d) => d.id === id)?.indexed ?? false;
