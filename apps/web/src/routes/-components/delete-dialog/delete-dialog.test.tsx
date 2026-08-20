import { NO_MEDIA } from '@r2-drive/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeleteDialog } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

afterEach(cleanup);

const objects: readonly ObjectDescriptor[] = Array.from({ length: 7 }, (_, index) => ({
  bucketId: 'photos',
  key: `folder/file-${index}.txt`,
  name: `file-${index}.txt`,
  contentType: 'text/plain',
  size: index,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: `etag-${index}`,
  media: NO_MEDIA,
}));

describe('DeleteDialog', () => {
  it('件数、先頭 5 件、残件数、取り消せない警告を示す', () => {
    render(<DeleteDialog state={{ kind: 'ready', objects }} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('alertdialog', { name: '7 件を削除しますか' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['file-0.txt', 'file-1.txt', 'file-2.txt', 'file-3.txt', 'file-4.txt']);
    expect(screen.getByText('ほか 2 件')).toBeTruthy();
    expect(screen.getByText('この操作は元に戻せません。')).toBeTruthy();
  });

  it('キャンセルへ初期フォーカスを置き Escape で閉じる', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<DeleteDialog state={{ kind: 'ready', objects: objects.slice(0, 1) }} onConfirm={vi.fn()} onCancel={onCancel} />);

    const cancel = screen.getByRole('button', { name: 'キャンセル' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('削除ボタンをキーボードで確認できる', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DeleteDialog state={{ kind: 'ready', objects: objects.slice(0, 1) }} onConfirm={onConfirm} onCancel={vi.fn()} />);

    const confirm = screen.getByRole('button', { name: '削除' });
    confirm.focus();
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('削除中は二重送信と dismiss を止める', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteDialog state={{ kind: 'deleting', objects: objects.slice(0, 1) }} onConfirm={onConfirm} onCancel={onCancel} />);

    expect(screen.getByRole('button', { name: 'キャンセル' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '削除中' }).hasAttribute('disabled')).toBe(true);
    await user.keyboard('{Escape}');

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('失敗内容を alert で残し、削除を再試行できる', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DeleteDialog state={{ kind: 'error', objects: objects.slice(0, 1), message: 'R2 が削除を拒否しました' }} onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toBe('R2 が削除を拒否しました');
    await user.click(screen.getByRole('button', { name: '削除を再試行' }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
