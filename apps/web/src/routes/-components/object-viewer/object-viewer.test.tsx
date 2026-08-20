import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ObjectViewerOverlay } from './index';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string): ObjectDescriptor => ({
  bucketId: 'b',
  key,
  name: key,
  contentType,
  size: 1024,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
});

const objects = [make('a.png', 'image/png'), make('b.bin', 'application/octet-stream'), make('c.jpg', 'image/jpeg')];

// deep link fetch 経路はこのテストでは踏まない(objects に必ず居る key を使う)ので、
// client はダミーで良い。fetch 経路は Task 12 のブラウザ確認で見る。
const client = {} as ApiClient;
const getContentUrl = (o: ObjectDescriptor) => `/content/${o.key}`;

const renderOverlay = (props: Partial<Parameters<typeof ObjectViewerOverlay>[0]> = {}) => {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectViewerOverlay
        client={client}
        bucketId="b"
        objects={objects}
        request={{ kind: 'open', objectKey: 'a.png' }}
        getContentUrl={getContentUrl}
        onClose={onClose}
        onNavigate={onNavigate}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose, onNavigate };
};

describe('ObjectViewerOverlay', () => {
  it('closed のときは dialog を出さない', () => {
    renderOverlay({ request: { kind: 'closed' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open のとき dialog にファイル名とメタデータが出る', async () => {
    renderOverlay();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('a.png').length).toBeGreaterThan(0);
    expect(screen.getByText(/1,024 B/)).toBeTruthy();
  });

  it('ArrowRight で次の view 可能ファイル(opaque スキップ)へ navigate する', async () => {
    const { onNavigate } = renderOverlay();
    await screen.findByRole('dialog');
    await userEvent.keyboard('{ArrowRight}');
    expect(onNavigate).toHaveBeenCalledWith('c.jpg');
  });

  it('先頭で ArrowLeft は何もしない', async () => {
    const { onNavigate } = renderOverlay();
    await screen.findByRole('dialog');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('opaque の key を deep link で開くと「表示できません」を出す', async () => {
    renderOverlay({ request: { kind: 'open', objectKey: 'b.bin' } });
    await screen.findByRole('dialog');
    expect(await screen.findByText(/表示できません/)).toBeTruthy();
  });
});
