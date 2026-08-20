import { resolveFileType } from '../../../../plugins/file-type/registry';

import type { ObjectDescriptor } from '@r2-drive/core';

export const isViewable = (object: ObjectDescriptor): boolean =>
  resolveFileType(object).match(
    (match) => match.capability.kind === 'view',
    () => false,
  );

// 一覧の描画順(= 現在のソート順)における前後の view 可能ファイル。
// 対象は読み込み済みページ内に限る。末尾に達したら undefined(次ページは取らない)。
export const findAdjacentViewable = (objects: readonly ObjectDescriptor[], currentKey: string, direction: 1 | -1): ObjectDescriptor | undefined => {
  const index = objects.findIndex((object) => object.key === currentKey);
  if (index === -1) return undefined;

  const candidates = direction === 1 ? objects.slice(index + 1) : [...objects.slice(0, index)].reverse();

  return candidates.find(isViewable);
};
