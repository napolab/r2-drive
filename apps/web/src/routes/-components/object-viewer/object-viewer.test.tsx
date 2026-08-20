import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObjectViewerOverlay } from './index';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';

// このファイルの他テストは request.kind: 'open' でダイアログを開いたまま終わるものが多く、
// cleanup が無いと次の it() の DOM に残り続けて `screen.findByAltText` 等が
// 複数マッチで失敗する(同じ 'a.png' を複数の it() が開くため)。
afterEach(cleanup);

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

  it('画像の読込に失敗すると MediaLoadError のメッセージとダウンロードリンクを出す(ErrorBoundary の出し分け)', async () => {
    renderOverlay();
    const image = await screen.findByAltText('a.png');

    // <img onError> は throw できないので viewer は render 中に throw する。
    // ここでは実際の失敗経路(onError イベント)から ErrorBoundary までを通しで確認する。
    fireEvent.error(image);

    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain('画像を読み込めませんでした');

    const downloadLink = within(failure).getByRole('link', { name: 'ダウンロード' });
    expect(downloadLink.getAttribute('href')).toBe('/content/a.png');
  });

  it('あるファイルでビューアが失敗しても、次のファイルへ移動すればエラー表示が残らない(object 単位でエラーバウンダリがリセットされる)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network error'))),
    );

    const failingObjects = [make('readme.txt', 'text/plain'), make('a.png', 'image/png')];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ObjectViewerOverlay
          client={client}
          bucketId="b"
          objects={failingObjects}
          request={{ kind: 'open', objectKey: 'readme.txt' }}
          getContentUrl={getContentUrl}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const failureNotice = await screen.findByText(/ビューアを読み込めませんでした/);
    const failingDialog = failureNotice.closest('[role="dialog"]');
    if (!(failingDialog instanceof HTMLElement)) throw new Error('dialog element not found');

    rerender(
      <QueryClientProvider client={queryClient}>
        <ObjectViewerOverlay
          client={client}
          bucketId="b"
          objects={failingObjects}
          request={{ kind: 'open', objectKey: 'a.png' }}
          getContentUrl={getContentUrl}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // 同じ Dialog DOM ノード(ViewerDialog は remount しない)の中で見比べる。
    // 過去の it() が残した leftover なテスト DOM は aria-hidden で隠れるため
    // role query では拾われないが、alt テキストのようなプレーンな query は
    // 拾ってしまうことがあるので、比較は必ず対象の dialog 配下に絞る。
    expect(within(failingDialog).queryByText(/ビューアを読み込めませんでした/)).toBeNull();
    expect(await within(failingDialog).findByAltText('a.png')).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
