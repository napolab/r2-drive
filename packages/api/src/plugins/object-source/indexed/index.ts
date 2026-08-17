import { R2OperationError } from '@r2-drive/core';
import { err, ok, ResultAsync } from 'neverthrow';

import { isIndexed, resolveObjectIndex } from '../../../object-index/registry';

import type { ObjectSource } from '../types';
import type { DriveError, ObjectPage } from '@r2-drive/core';

// 1 ページの件数はこのプラグインの都合。r2-list/index.ts の R2_LIST_PAGE_SIZE を
// import して再利用しない(意図的な重複)。R2 の list() 上限と索引のページ件数は
// 別の関心事であり、片方を変えたときにもう片方が引きずられてはならない。
const INDEX_PAGE_SIZE = 1000;

// ディスパッチは同期(このバケットを担当するか)、仕事は非同期。
// 担当判定に DO への問い合わせを使わないのが要点(Phase 1 spec §6)。
export const indexedSource: ObjectSource = {
  id: 'indexed',
  run: (input) => {
    if (!isIndexed(input.bucketId)) return err(input);

    return ok(
      resolveObjectIndex(input.env, input.bucketId).asyncAndThen((stub) =>
        ResultAsync.fromPromise<ObjectPage, DriveError>(
          stub.list({ bucketId: input.bucketId, prefix: input.prefix, cursor: input.cursor, limit: INDEX_PAGE_SIZE }),
          (cause) => new R2OperationError(`index list failed: ${input.prefix}`, { cause }),
        ),
      ),
    );
  },
};
