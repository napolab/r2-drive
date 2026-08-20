import { indexRemove, indexUpsert } from '../../../object-index/registry';

import type { ObjectHook } from '../types';

// 既存のルート直書きだった索引書き込みを hook 化したもの。挙動は従来と同一。
export const indexWriteHook: ObjectHook = {
  id: 'index-write',
  run(event) {
    switch (event.kind) {
      case 'uploaded':
        return indexUpsert(event.env, event.descriptor);
      case 'removed':
        return indexRemove(event.env, event.bucketId, event.key);
      default: {
        const _exhaustive: never = event;
        throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
      }
    }
  },
};
