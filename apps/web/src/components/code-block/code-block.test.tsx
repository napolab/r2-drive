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
});
