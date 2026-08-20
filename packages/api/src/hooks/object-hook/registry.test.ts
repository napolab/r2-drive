import { R2OperationError } from '@r2-drive/core';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { runHooks } from './registry';

import type { ObjectHook, ObjectHookEvent } from './types';

const event = { kind: 'removed', env: {} as Env, bucketId: 'b', key: 'k' } satisfies ObjectHookEvent;

describe('runHooks', () => {
  it('先行 hook の失敗が後続の実行を止めない', async () => {
    const ran: string[] = [];
    const failing: ObjectHook = { id: 'fail', run: () => errAsync(new R2OperationError('boom')) };
    const following: ObjectHook = {
      id: 'after',
      run() {
        ran.push('after');

        return okAsync(undefined);
      },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runHooks([failing, following], event);
    expect(ran).toEqual(['after']);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('全 hook 成功時は何もログしない(テスト出力を汚さない)', async () => {
    const ok: ObjectHook = { id: 'ok', run: () => okAsync(undefined) };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runHooks([ok, ok], event);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
