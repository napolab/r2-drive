import { ok } from 'neverthrow';

import { resolveBucket } from '../../../r2/registry';
import { listObjects } from '../../../r2/list';

import type { ObjectSource } from '../types';

// 常に ok を返す最終防衛線。索引が無い / 追いついていないバケットの受け皿。
export const r2ListSource: ObjectSource = {
  id: 'r2-list',
  run: (input) => ok(resolveBucket(input.env, input.bucketId).asyncAndThen((bucket) => listObjects({ bucket, bucketId: input.bucketId, prefix: input.prefix, cursor: input.cursor }))),
};
