import { R2OperationError } from '@r2-drive/core';
import { okAsync, ResultAsync } from 'neverthrow';

import { probeImageDimensions } from '../../../media/dimensions';
import { resolveObjectIndex } from '../../../object-index/registry';

import type { ObjectHook } from '../types';

// 画像なら寸法を抽出して索引の行に書く。removed では何もしない(行ごと消える)。
// index-write の後に走る前提(registry の配列順)。行がまだ無い場合 setMediaFacts は
// 0 行更新で終わる(Task 2 の仕様)。
export const mediaFactsHook: ObjectHook = {
  id: 'media-facts',
  run(event) {
    if (event.kind !== 'uploaded') return okAsync(undefined);
    if (!event.descriptor.contentType.startsWith('image/')) return okAsync(undefined);

    return probeImageDimensions(event.bucket, event.descriptor.key).andThen((dimensions) => {
      if (dimensions === undefined) return okAsync(undefined);

      return resolveObjectIndex(event.env, event.descriptor.bucketId).asyncAndThen((stub) =>
        ResultAsync.fromPromise(
          stub.setMediaFacts(event.descriptor.key, dimensions.width, dimensions.height),
          (cause) => new R2OperationError(`setMediaFacts failed: ${event.descriptor.key}`, { cause }),
        ),
      );
    });
  },
};
