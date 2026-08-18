import { R2OperationError } from '@r2-drive/core';
import { errAsync, ok } from 'neverthrow';

import { isIndexCursor } from '../../../object-index/cursor/index';
import { ForeignCursorError } from '../../../object-index/errors';
import { resolveBucket } from '../../../r2/registry';
import { listObjects } from '../../../r2/list';

import type { ObjectSource } from '../types';

// 1 ページの件数はデータ供給元の都合なので、このプラグインが持つ。
// 1000 は R2 list() の limit 上限。include: ['httpMetadata'] を外したので
// レスポンスのデータ量で打ち切られなくなり、上限まで使い切れる
// (include があると limit をいくつにしても 100 件に丸められる)。
const R2_LIST_PAGE_SIZE = 1000;

// Ruling 23: 索引が発行した cursor をそのまま R2 へ渡さない。
//
// **実測(2026-08-18、miniflare 上): R2 は不正な cursor を弾かない。**
// `list({ cursor: 'q1:pf/1.txt' })` は例外を投げず `objects: []` / `truncated: false` を
// 返し、listObjects がそれを `next: { kind: 'end' }` に畳む。つまり**一覧が静かに
// 「ここで終わり」になる**——Ruling 18 が索引側で塞いだのと同じ失敗クラスの裏返しである。
//
// **`indexed: false` のバケットでも踏める。**検索は indexed に関わらず索引 DO を通るので
// `q1:` cursor を返し、それを一覧に渡すとこの経路に流れてくる。
//
// DriveError は packages/core の閉じた union なので ForeignCursorError をそのまま
// 流せない。R2OperationError で包む(索引経路が DO の例外を包むのと同じ形)。
// respondTo は cause チェーンを掘るので、消費エッジでは 412 になる。
// **外側の message に cursor を載せないこと**(cursor は索引では key そのもの)。
const rejectIndexCursor = () => errAsync(new R2OperationError('list cursor rejected by r2 source', { cause: new ForeignCursorError('r2 list') }));

// 常に ok を返す最終防衛線。索引が無い / 追いついていないバケットの受け皿。
// **ok なのは「このバケットを担当する」というディスパッチの表明**であって、
// 仕事が必ず成功するという意味ではない(cursor の拒否はここで err になる)。
export const r2ListSource: ObjectSource = {
  id: 'r2-list',
  run: (input) => {
    if (input.cursor !== undefined && isIndexCursor(input.cursor)) return ok(rejectIndexCursor());

    return ok(
      resolveBucket(input.env, input.bucketId).asyncAndThen((bucket) => listObjects({ bucket, bucketId: input.bucketId, prefix: input.prefix, cursor: input.cursor, limit: R2_LIST_PAGE_SIZE })),
    );
  },
};
