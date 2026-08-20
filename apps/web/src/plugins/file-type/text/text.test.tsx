import { NO_MEDIA } from '@r2-drive/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRELOADED_LANGUAGE_KEYS } from '../../../highlight/index';
import { MAX_TEXT_VIEWER_BYTES } from '../text-viewer-limit';
import { resolveFileType } from '../registry';
import { EXTENSION_LANGUAGES, languageOf, textPlugin } from './index';
import TextViewer from './viewer';

import type { ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string, size = 1): ObjectDescriptor => ({
  bucketId: 'b',
  key,
  name: key.split('/').pop() ?? key,
  contentType,
  size,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
  media: NO_MEDIA,
});

describe('textPlugin', () => {
  it('text/* の contentType にマッチする', () => {
    const result = textPlugin.run(make('a.txt', 'text/plain'));
    expect(result.isOk() && result.value.typeId).toBe('text');
  });

  it('コード系拡張子は contentType が octet-stream でもマッチする', () => {
    const result = textPlugin.run(make('config.toml', 'application/octet-stream'));
    expect(result.isOk() && result.value.typeId).toBe('text');
  });

  it('画像にはマッチしない', () => {
    expect(textPlugin.run(make('a.png', 'image/png')).isErr()).toBe(true);
  });

  it('view capability を持つ', () => {
    const result = textPlugin.run(make('a.txt', 'text/plain'));
    expect(result.isOk() && result.value.capability.kind).toBe('view');
  });
});

describe('languageOf', () => {
  it('拡張子から言語を引く', () => {
    expect(languageOf('app.ts')).toBe('typescript');
    expect(languageOf('styles.css')).toBe('css');
  });

  it('未知の拡張子は text', () => {
    expect(languageOf('notes.unknown')).toBe('text');
  });
});

describe('registry との整合', () => {
  it('.md は markdown が先に取る(text に落ちない)', () => {
    const result = resolveFileType(make('readme.md', 'text/markdown'));
    expect(result.isOk() && result.value.typeId).toBe('markdown');
  });

  it('text/markdown は markdownPlugin が取るので textPlugin に届かない(順序保証)', () => {
    // registry 順: markdown → ... → text。ここでは registry を通した結果だけを固定する。
    const result = resolveFileType(make('readme.markdown', 'text/markdown'));
    expect(result.isOk() && result.value.typeId).toBe('markdown');
  });

  it('拡張子マップの言語はすべて highlight が読み込める(cross-module-sync)', () => {
    for (const language of Object.values(EXTENSION_LANGUAGES)) {
      expect(PRELOADED_LANGUAGE_KEYS).toContain(language);
    }
  });
});

describe('TextViewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('size が上限を超えるときは Range 付きで先頭 128 KiB だけ fetch する(全文は取らない)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('a\nb\nc', { status: 206 }));
    vi.stubGlobal('fetch', fetchSpy);

    const object = make('big.txt', 'text/plain', MAX_TEXT_VIEWER_BYTES + 1);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TextViewer object={object} getContentUrl={() => '/content/big.txt'} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/先頭 300 行のみ表示/)).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/content/big.txt', { headers: { range: 'bytes=0-131071' } });
  });
});
