import { describe, expect, it } from 'vitest';

import { resolveAction } from './registry';

describe('resolveAction', () => {
  it('actionId で対応する記述子を返す', () => {
    expect(resolveAction({ actionId: 'copy-path', objects: [] })._unsafeUnwrap().label).toBe('パスをコピー');
  });

  it('download も対応する記述子を返す', () => {
    expect(resolveAction({ actionId: 'download', objects: [] })._unsafeUnwrap().label).toBe('ダウンロード');
  });

  it('delete は destructive', () => {
    expect(resolveAction({ actionId: 'delete', objects: [] })._unsafeUnwrap().destructive).toBe(true);
  });

  it('未知の actionId は err', () => {
    expect(resolveAction({ actionId: 'nope', objects: [] }).isErr()).toBe(true);
  });
});
