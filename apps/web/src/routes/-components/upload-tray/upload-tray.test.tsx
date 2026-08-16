import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UploadTray } from './index';

import type { UploadTrayItem } from './index';

afterEach(cleanup);

const items: readonly UploadTrayItem[] = [
  { id: 'queued', name: 'queued.bin', progress: 0, state: 'queued' },
  { id: 'uploading', name: 'uploading.bin', progress: 42, state: 'uploading' },
  { id: 'error', name: 'error.bin', progress: 60, state: 'error', message: 'network failed' },
  { id: 'complete', name: 'complete.bin', progress: 100, state: 'complete' },
];

const uploadingItem: UploadTrayItem = { id: 'uploading', name: 'uploading.bin', progress: 42, state: 'uploading' };

describe('UploadTray', () => {
  it('item が無ければ何も描画しない', () => {
    const { container } = render(<UploadTray items={[]} onCancel={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it('queued/uploading/error/complete を data-state と determinate progress で公開する', () => {
    render(<UploadTray items={items} onCancel={vi.fn()} />);

    for (const item of items) {
      expect(screen.getByText(item.name).closest('[data-state]')?.getAttribute('data-state')).toBe(item.state);
      expect(screen.getByRole('progressbar', { name: `${item.name} の進捗` }).getAttribute('aria-valuenow')).toBe(`${item.progress}`);
    }
    expect(screen.getByText('network failed')).toBeTruthy();
  });

  it('中断ボタンをキーボードで押すと Uppy removeFile 用 callback へ対象 id を返す', async () => {
    const removeFile = vi.fn();
    render(<UploadTray items={[uploadingItem]} onCancel={removeFile} />);

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(removeFile).toHaveBeenCalledWith('uploading');
  });
});
