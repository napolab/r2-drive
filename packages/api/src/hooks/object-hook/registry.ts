import { indexWriteHook } from './index-write/index';
import { mediaFactsHook } from './media-facts/index';

import type { ObjectHook, ObjectHookEvent } from './types';

// 全 hook を順に実行する(first-match ではない)。順序に意味がある:
// media-facts は index-write が作った行を UPDATE する。
export const objectHooks = [indexWriteHook, mediaFactsHook] as const satisfies readonly ObjectHook[];

// hook の失敗はリクエストを落とさない(R2 が真実、索引は飾り)。
// 各 hook は独立に実行し、1 つの失敗で後続をスキップしない。
// runHooks を分けているのは失敗独立性を単体テストで固定するため(registry.test.ts)。
export const runHooks = async (hooks: readonly ObjectHook[], event: ObjectHookEvent): Promise<void> => {
  for (const hook of hooks) {
    await hook.run(event).match(
      () => undefined,
      (error) => console.error(`object hook '${hook.id}' failed:`, error),
    );
  }
};

export const runObjectHooks = (event: ObjectHookEvent): Promise<void> => runHooks(objectHooks, event);
