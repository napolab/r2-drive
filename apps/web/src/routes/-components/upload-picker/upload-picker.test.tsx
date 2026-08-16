import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UploadPicker } from './index';

afterEach(cleanup);

describe('UploadPicker', () => {
  it('keyboard/file picker で選んだ File を同じ callback へ渡す', async () => {
    const onFiles = vi.fn();
    const { container } = render(<UploadPicker onFiles={onFiles} />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('FileTrigger input was not rendered');
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    await userEvent.upload(input, file);

    expect(screen.getByRole('button', { name: 'ファイルを追加' })).toBeTruthy();
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});
