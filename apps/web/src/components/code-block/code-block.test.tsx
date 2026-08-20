import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CodeBlock } from './index';

describe('CodeBlock', () => {
  it('ハイライト完了前も生のコードが見えている', () => {
    render(<CodeBlock code="const a = 1;" language="typescript" />);
    expect(screen.getByText('const a = 1;')).toBeTruthy();
  });

  it('ハイライト完了後は shiki の出力に置き換わる', async () => {
    const { container } = render(<CodeBlock code="const a = 1;" language="typescript" />);
    await waitFor(() => expect(container.querySelector('pre.shiki')).toBeTruthy());
  });

  it('マウント済みの CodeBlock に新しい code/language が来ると、古いハイライトではなく新しい生コードにフォールバックしてから再ハイライトされる', async () => {
    const { container, rerender } = render(<CodeBlock code="const a = 1;" language="typescript" />);
    await waitFor(() => expect(container.querySelector('pre.shiki')).toBeTruthy());

    rerender(<CodeBlock code="const b = 2;" language="javascript" />);

    // 古い ready state(const a = 1; の shiki 出力)を再利用せず、
    // 新しい props の生コードが pre にフォールバックしている。
    expect(screen.getByText('const b = 2;')).toBeTruthy();
    expect(container.querySelector('pre.shiki')).toBeNull();

    await waitFor(() => expect(container.querySelector('pre.shiki')).toBeTruthy());
    expect(container.textContent).toContain('const b = 2;');
  });
});
