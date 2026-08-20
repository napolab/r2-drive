import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ViewerTooLarge } from './index';

describe('ViewerTooLarge', () => {
  it('サイズとダウンロード導線が出る', () => {
    render(
      <ViewerTooLarge
        object={{ bucketId: 'b', key: 'big.md', name: 'big.md', contentType: 'text/markdown', size: 2_000_000, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' }}
        getContentUrl={() => '/content/big.md'}
      />,
    );
    expect(screen.getByText(/2,000,000 B/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ダウンロード' })).toBeTruthy();
  });
});
