import { describe, expect, it } from 'vitest';

import { resolveFileType } from './registry';

import type { ObjectDescriptor } from '@r2-drive/core';

const object = (name: string, contentType: string): ObjectDescriptor => ({
  bucketId: 'photos',
  key: name,
  name,
  contentType,
  size: 1,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'e',
});

describe('resolveFileType', () => {
  it('markdown を拡張子で拾う', () => {
    expect(resolveFileType(object('a.md', 'text/markdown'))._unsafeUnwrap().typeId).toBe('markdown');
  });

  it('contentType が octet-stream でも .md なら markdown', () => {
    expect(resolveFileType(object('a.md', 'application/octet-stream'))._unsafeUnwrap().typeId).toBe('markdown');
  });

  it('image/* を拾う', () => {
    expect(resolveFileType(object('a.png', 'image/png'))._unsafeUnwrap().typeId).toBe('image');
  });

  it('video/* を拾う', () => {
    expect(resolveFileType(object('a.mp4', 'video/mp4'))._unsafeUnwrap().typeId).toBe('video');
  });

  it('audio/* を拾う', () => {
    expect(resolveFileType(object('a.flac', 'audio/flac'))._unsafeUnwrap().typeId).toBe('audio');
  });

  it('未知のものは opaque に落ちる', () => {
    expect(resolveFileType(object('a.bin', 'application/octet-stream'))._unsafeUnwrap().typeId).toBe('opaque');
  });

  it('opaque は常にマッチするので err にならない', () => {
    expect(resolveFileType(object('', ''))?.isOk()).toBe(true);
  });
});
