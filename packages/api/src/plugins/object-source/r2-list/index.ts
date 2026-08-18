import { ok } from 'neverthrow';

import { resolveBucket } from '../../../r2/registry';
import { listObjects } from '../../../r2/list';

import type { ObjectSource } from '../types';

// 1 ページの件数はデータ供給元の都合なので、このプラグインが持つ。
// 1000 は R2 list() の limit 上限。include: ['httpMetadata'] を外したので
// レスポンスのデータ量で打ち切られなくなり、上限まで使い切れる
// (include があると limit をいくつにしても 100 件に丸められる)。
const R2_LIST_PAGE_SIZE = 1000;

// 常に ok を返す最終防衛線。索引が無い / 追いついていないバケットの受け皿。
export const r2ListSource: ObjectSource = {
  id: 'r2-list',
  run: (input) =>
    ok(resolveBucket(input.env, input.bucketId).asyncAndThen((bucket) => listObjects({ bucket, bucketId: input.bucketId, prefix: input.prefix, cursor: input.cursor, limit: R2_LIST_PAGE_SIZE }))),
};
