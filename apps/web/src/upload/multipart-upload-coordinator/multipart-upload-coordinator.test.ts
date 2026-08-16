import { describe, expect, it, vi } from 'vitest';

import { createMultipartUploadCoordinator } from './index';

import type { MultipartSession } from './index';

const session = (uploadId: string, key = `${uploadId}.bin`) => ({ uploadId, key });

describe('createMultipartUploadCoordinator', () => {
  it('create response 前の cancel を response 後に cleanup して AbortError にする', async () => {
    const cleanup = vi.fn(async (_value: MultipartSession) => {});
    const coordinator = createMultipartUploadCoordinator({ onCleanupError: vi.fn() });
    const attempt = coordinator.begin('file-1');

    coordinator.cancelFile('file-1');

    await expect(coordinator.created(attempt, session('upload-1'), cleanup)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(session('upload-1'));
  });

  it('create response 後の cancel と Uppy abort callback が競合しても cleanup は一度だけ', async () => {
    let resolveCleanup!: () => void;
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );
    const coordinator = createMultipartUploadCoordinator({ onCleanupError: vi.fn() });
    const attempt = coordinator.begin('file-1');
    const created = await coordinator.created(attempt, session('upload-1'), cleanup);

    coordinator.cancelFile('file-1');
    const uppyAbort = coordinator.abort('file-1', created, cleanup);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();

    resolveCleanup();
    await uppyAbort;
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('cancel cleanup 中の complete は ownership を奪わず後続 Uppy abort と cleanup を共有する', async () => {
    let resolveCleanup!: () => void;
    const cleanupResponse = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const cleanup = vi.fn(() => cleanupResponse);
    const coordinator = createMultipartUploadCoordinator({ onCleanupError: vi.fn() });
    const attempt = coordinator.begin('file-1');
    const created = await coordinator.created(attempt, session('upload-1'), cleanup);

    coordinator.cancelFile('file-1');
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();

    coordinator.complete('file-1', created);
    const uppyAbort = coordinator.abort('file-1', created, cleanup);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();

    resolveCleanup();
    await uppyAbort;
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('successful complete は state を解放し、後続 cancel の対象にしない', async () => {
    const cleanup = vi.fn(async (_value: MultipartSession) => {});
    const coordinator = createMultipartUploadCoordinator({ onCleanupError: vi.fn() });
    const attempt = coordinator.begin('file-1');
    const created = await coordinator.created(attempt, session('upload-1'), cleanup);

    coordinator.complete('file-1', created);
    coordinator.cancelFile('file-1');

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('create error は解放し、upload error は同じ session の cancel で cleanup できる', async () => {
    const cleanup = vi.fn(async (_value: MultipartSession) => {});
    const coordinator = createMultipartUploadCoordinator({ onCleanupError: vi.fn() });
    const failedAttempt = coordinator.begin('file-1');
    coordinator.createFailed(failedAttempt, new Error('create failed'));
    coordinator.cancelFile('file-1');
    expect(cleanup).not.toHaveBeenCalled();

    const uploadAttempt = coordinator.begin('file-1');
    const created = await coordinator.created(uploadAttempt, session('upload-2'), cleanup);
    coordinator.uploadFailed('file-1', created, new Error('part failed'));
    coordinator.cancelFile('file-1');

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(cleanup).toHaveBeenCalledWith(session('upload-2'));
  });

  it('cleanup failure は一度だけ通知し次の cancel だけが retry し、same-id re-add と混線しない', async () => {
    const cleanupFailure = new Error('cleanup failed');
    const onCleanupError = vi.fn();
    let oldSessionCalls = 0;
    const cleanup = vi.fn(async (value: MultipartSession) => {
      if (value.uploadId !== 'old-upload') return;
      oldSessionCalls += 1;
      if (oldSessionCalls === 1) throw cleanupFailure;
    });
    const coordinator = createMultipartUploadCoordinator({ onCleanupError });
    const oldAttempt = coordinator.begin('same-file');
    const oldSession = await coordinator.created(oldAttempt, session('old-upload'), cleanup);

    coordinator.cancelFile('same-file');
    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(onCleanupError).toHaveBeenCalledOnce();
    });
    expect(onCleanupError).toHaveBeenCalledWith(expect.objectContaining({ name: 'MultipartCleanupError', cause: cleanupFailure }));

    coordinator.complete('same-file', oldSession);
    coordinator.cancelFile('same-file');
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
    expect(cleanup.mock.calls.map(([value]) => value)).toEqual([session('old-upload'), session('old-upload')]);
    expect(onCleanupError).toHaveBeenCalledOnce();

    const readdedAttempt = coordinator.begin('same-file');
    const readdedSession = await coordinator.created(readdedAttempt, session('new-upload'), cleanup);
    coordinator.cancelFile('same-file');
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(3));
    expect(cleanup.mock.calls[2]).toEqual([session('new-upload')]);

    await coordinator.abort('same-file', oldSession, cleanup);
    expect(cleanup).toHaveBeenCalledTimes(3);
    await coordinator.abort('same-file', readdedSession, cleanup);
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(onCleanupError).toHaveBeenCalledOnce();
  });

  it('re-add と複数 file の pending attempt を取り違えない', async () => {
    const cleanup = vi.fn(async (_value: MultipartSession) => {});
    const coordinator = createMultipartUploadCoordinator({ onCleanupError: vi.fn() });
    const removedAttempt = coordinator.begin('same-file');
    const otherAttempt = coordinator.begin('other-file');
    coordinator.cancelFile('same-file');
    const readdedAttempt = coordinator.begin('same-file');

    const readded = await coordinator.created(readdedAttempt, session('readded'), cleanup);
    const other = await coordinator.created(otherAttempt, session('other'), cleanup);
    await expect(coordinator.created(removedAttempt, session('removed'), cleanup)).rejects.toMatchObject({ name: 'AbortError' });

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(session('removed'));
    coordinator.complete('same-file', readded);
    coordinator.complete('other-file', other);
  });

  it('cancelAll は全 pending attempt を同じ補償経路へ送る', async () => {
    const cleanup = vi.fn(async (_value: MultipartSession) => {});
    const coordinator = createMultipartUploadCoordinator({ onCleanupError: vi.fn() });
    const first = coordinator.begin('file-1');
    const second = coordinator.begin('file-2');

    coordinator.cancelAll();

    await expect(coordinator.created(first, session('upload-1'), cleanup)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(coordinator.created(second, session('upload-2'), cleanup)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(cleanup.mock.calls.map(([value]) => value)).toEqual([session('upload-1'), session('upload-2')]);
  });
});
