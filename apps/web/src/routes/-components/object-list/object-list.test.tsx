import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObjectList } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

// vitest は globals: false なので @testing-library/react の自動 cleanup が登録されない。
// 登録しないと前のテストの DOM が残り、getByText が複数一致で落ちる。
afterEach(cleanup);

const objects: readonly ObjectDescriptor[] = Array.from({ length: 5 }, (_, i) => ({
  bucketId: 'photos',
  key: `f${i}.txt`,
  name: `f${i}.txt`,
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: `e${i}`,
}));

const noop = () => undefined;

// sizes.targetComfortable(44px)。実装は token から引くが、テストは値をベタ書きして
// 「行高が黙って変わった」ことを検出する側に置く。
const ROW_SIZE = 44;

describe('ObjectList', () => {
  it('オブジェクト名を並べる', () => {
    render(<ObjectList folders={[]} objects={objects} onSelectionChange={vi.fn()} onOpenFolder={vi.fn()} onPrefetchFolder={noop} onLoadMore={noop} isLoadingMore={false} />);

    expect(screen.getByText('f0.txt')).toBeTruthy();
  });

  it('キーボードだけで移動して選択できる', async () => {
    const onSelectionChange = vi.fn();
    render(<ObjectList folders={[]} objects={objects} onSelectionChange={onSelectionChange} onOpenFolder={vi.fn()} onPrefetchFolder={noop} onLoadMore={noop} isLoadingMore={false} />);

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{ArrowDown} ');

    expect(onSelectionChange).toHaveBeenCalled();
  });

  it('shift+ArrowDown で範囲選択が伸びる', async () => {
    const onSelectionChange = vi.fn();
    render(<ObjectList folders={[]} objects={objects} onSelectionChange={onSelectionChange} onOpenFolder={vi.fn()} onPrefetchFolder={noop} onLoadMore={noop} isLoadingMore={false} />);

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown} {Shift>}{ArrowDown}{ArrowDown}{/Shift}');

    const last = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(last.size).toBeGreaterThan(1);
  });

  it('フォルダを Enter で開ける', async () => {
    const onOpenFolder = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={[]}
        onSelectionChange={vi.fn()}
        onOpenFolder={onOpenFolder}
        onPrefetchFolder={noop}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onOpenFolder).toHaveBeenCalledWith('docs/');
  });

  // jsdom は要素の実サイズを 0 で返すため、可視領域が決まらず Virtualizer は全行を DOM に出す。
  // つまり「画面外の行が DOM から消える」ことは jsdom では確認できない(実測は Task 16)。
  // ここで確認できるのは ListLayout が行高を受け取ってスクロール領域を計算していること
  // ——「素の仮想化ライブラリではなく ListLayout が効いている」ことの証拠。
  it('ListLayout がスクロール領域を行数 × 行高で確保する', () => {
    render(<ObjectList folders={[]} objects={objects} onSelectionChange={vi.fn()} onOpenFolder={vi.fn()} onPrefetchFolder={noop} onLoadMore={noop} isLoadingMore={false} />);

    const scrollContent = screen.getByRole('grid').firstElementChild;

    expect((scrollContent as HTMLElement | null)?.style.height).toBe(`${objects.length * ROW_SIZE}px`);
  });

  it('フォルダ行にホバーするとプリフェッチを頼む', async () => {
    const onPrefetchFolder = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={[]}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={onPrefetchFolder}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.hover(screen.getByText('docs'));

    expect(onPrefetchFolder).toHaveBeenCalledWith('docs/');
  });

  it('キーボードでフォルダ行にフォーカスしてもプリフェッチを頼む', async () => {
    const onPrefetchFolder = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={objects}
        onSelectionChange={vi.fn()}
        onOpenFolder={vi.fn()}
        onPrefetchFolder={onPrefetchFolder}
        onLoadMore={noop}
        isLoadingMore={false}
      />,
    );

    await userEvent.tab();

    expect(onPrefetchFolder).toHaveBeenCalledWith('docs/');
  });
});
