import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { headLines, HEAD_PREVIEW_MAX_LINES, ViewerHeadPreview } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('headLines', () => {
  it('maxLines 以下の行数はそのまま complete で返す', () => {
    const text = 'a\nb\nc';
    expect(headLines(text, 5)).toEqual({ kind: 'complete', text });
  });

  it('ちょうど maxLines 行なら complete', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
    expect(headLines(lines.join('\n'), 300)).toEqual({ kind: 'complete', text: lines.join('\n') });
  });

  it('maxLines を超える行数は先頭 maxLines 行だけの truncated を返す', () => {
    const lines = Array.from({ length: 301 }, (_, i) => `line ${i + 1}`);
    const result = headLines(lines.join('\n'), 300);
    expect(result.kind).toBe('truncated');
    expect(result.text).toBe(lines.slice(0, 300).join('\n'));
  });
});

const object: ObjectDescriptor = {
  bucketId: 'b',
  key: 'big.txt',
  name: 'big.txt',
  contentType: 'text/plain',
  size: 2_000_000,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
};

describe('ViewerHeadPreview', () => {
  it('先頭 300 行だけ描画し、301 行目以降は表示しない', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(lines.join('\n'), { status: 206 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ViewerHeadPreview object={object} getContentUrl={() => '/content/big.txt'} language="text" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(container.textContent).toContain('line 300'));
    expect(container.textContent).not.toContain('line 301');
  });

  it('先頭 128 KiB だけを Range で要求する', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('hello', { status: 206 }));
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ViewerHeadPreview object={object} getContentUrl={() => '/content/big.txt'} language="text" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith('/content/big.txt', { headers: { range: 'bytes=0-131071' } });
  });

  it(`案内文とダウンロード導線が出る(全体サイズ ${HEAD_PREVIEW_MAX_LINES} 行制限の告知)`, async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('a\nb\nc', { status: 206 }));
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ViewerHeadPreview object={object} getContentUrl={() => '/content/big.txt'} language="text" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/先頭 300 行のみ表示/)).toBeTruthy();
    expect(screen.getByText(/2,000,000 B/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ダウンロード' })).toBeTruthy();
  });
});
