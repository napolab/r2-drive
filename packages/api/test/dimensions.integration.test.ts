import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { probeImageDimensions } from '../src/media/dimensions';
import { GIF_1x1, JPEG_1x1, NOT_AN_IMAGE, PNG_1x1, WEBP_1x1 } from './fixtures/images';

// SOF が DIMENSION_PROBE_BYTES(128 KiB)より後ろにある巨大 JPEG の「取れない → undefined」ケースは、
// それだけのバイト列を用意するのが大掛かりなためテスト対象外とする。実装は先頭 DIMENSION_PROBE_BYTES
// しか読まないので、その範囲に SOF が無ければ image-size が throw し、parseDimensions が undefined に倒す
// (「非画像 / 解析不能」と同じ経路)。

describe('probeImageDimensions', () => {
  it('PNG の寸法を先頭バイトから読む', async () => {
    await env.BUCKET_MEDIA.put('probe/a.png', PNG_1x1);
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/a.png');
    expect(result.isOk() && result.value).toEqual({ width: 1, height: 1 });
  });

  it('JPEG の寸法を先頭バイトから読む', async () => {
    await env.BUCKET_MEDIA.put('probe/a.jpg', JPEG_1x1);
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/a.jpg');
    expect(result.isOk() && result.value).toEqual({ width: 1, height: 1 });
  });

  it('GIF の寸法を先頭バイトから読む', async () => {
    await env.BUCKET_MEDIA.put('probe/a.gif', GIF_1x1);
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/a.gif');
    expect(result.isOk() && result.value).toEqual({ width: 1, height: 1 });
  });

  it('WebP の寸法を先頭バイトから読む', async () => {
    await env.BUCKET_MEDIA.put('probe/a.webp', WEBP_1x1);
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/a.webp');
    expect(result.isOk() && result.value).toEqual({ width: 1, height: 1 });
  });

  it('画像でないバイト列は undefined(err ではない)', async () => {
    await env.BUCKET_MEDIA.put('probe/b.txt', NOT_AN_IMAGE);
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/b.txt');
    expect(result.isOk() && result.value).toBeUndefined();
  });

  it('存在しないキーは undefined(削除との競合に安全)', async () => {
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/missing.png');
    expect(result.isOk() && result.value).toBeUndefined();
  });
});
