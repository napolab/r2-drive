import type { DriveError, ObjectDescriptor } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

// アップロード成功後 / 削除成功後にだけ発火する。R2 操作そのものの成否は
// hook の関与しないところで確定済み(hook は事後処理)。
export type ObjectHookEvent =
  | { readonly kind: 'uploaded'; readonly env: Env; readonly bucket: R2Bucket; readonly descriptor: ObjectDescriptor }
  | { readonly kind: 'removed'; readonly env: Env; readonly bucketId: string; readonly key: string };

// 全実行型。packages/core の createRunner(first-match で 1 つだけ選ぶディスパッチ)
// とは直交する拡張点である。ObjectHook は「登録された全部を順に実行する」ものであり、
// どれか 1 つを選ぶものではないため createRunner は使わない。
export type ObjectHook = {
  readonly id: string;
  run(event: ObjectHookEvent): ResultAsync<void, DriveError>;
};
