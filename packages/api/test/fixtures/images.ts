// 最小の実バイナリ画像フィクスチャ。Task 3(寸法抽出)/ Task 4(ObjectHook)/ Task 5(追い掛け)が共有する。
// 全て 1x1 で、image-size が寸法を読むのに必要なヘッダだけを持つ(ピクセルデータ・圧縮の妥当性は問わない)。

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const concatBytes = (...parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  parts.reduce((offset, part) => {
    bytes.set(part, offset);

    return offset + part.length;
  }, 0);

  return bytes;
};

// 1x1 red PNG(67 bytes、既知のリテラル)。
export const PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

// 1x1 JPEG。SOI + APP0(4 バイトのダミー segment)+ SOF0(height=1 / width=1)。
// image-size は SOF0 を見つけた時点で寸法を読んで返るため、エントロピー符号化データ(実ピクセル)は不要。
const jpegSOI = Uint8Array.from([0xff, 0xd8]);
const jpegAPP0 = Uint8Array.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
const jpegSOF0 = Uint8Array.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01]);
export const JPEG_1x1 = concatBytes(jpegSOI, jpegAPP0, jpegSOF0);

// 1x1 透過 GIF(GIF89a)。image-size は signature + Logical Screen Descriptor の
// width/height しか読まないため、Global Color Table 以降は省略する。
const gifSignature = ascii('GIF89a');
const gifWidthHeight = Uint8Array.from([0x01, 0x00, 0x01, 0x00]); // width=1, height=1 (LE)
const gifDescriptorTail = Uint8Array.from([0x00, 0x00, 0x00]); // packed byte(GCT なし)/ bg index / aspect ratio
export const GIF_1x1 = concatBytes(gifSignature, gifWidthHeight, gifDescriptorTail);

// 1x1 WebP(VP8X 拡張ヘッダ)。RIFF/WEBP/VP8X の 3 チャンクヘッダと
// canvas width-1 / height-1(各 24bit LE, どちらも 0 = 実寸 1)だけを持つ。
// VP8/VP8L の実ビットストリームは image-size が読まないため省略する。
const webpRIFF = ascii('RIFF');
const webpFileSize = Uint8Array.from([0x16, 0x00, 0x00, 0x00]); // file size - 8 = 22
const webpWEBP = ascii('WEBP');
const webpVP8X = ascii('VP8X');
const webpChunkSize = Uint8Array.from([0x0a, 0x00, 0x00, 0x00]); // VP8X chunk size = 10
const webpFlags = Uint8Array.from([0x00]); // 拡張機能なし
const webpReserved = Uint8Array.from([0x00, 0x00, 0x00]);
const webpWidthMinusOne = Uint8Array.from([0x00, 0x00, 0x00]); // width - 1 = 0 (width = 1)
const webpHeightMinusOne = Uint8Array.from([0x00, 0x00, 0x00]); // height - 1 = 0 (height = 1)
export const WEBP_1x1 = concatBytes(webpRIFF, webpFileSize, webpWEBP, webpVP8X, webpChunkSize, webpFlags, webpReserved, webpWidthMinusOne, webpHeightMinusOne);

// 画像でないバイト列(非画像 → undefined を確認するのに使う)。
export const NOT_AN_IMAGE = ascii('not an image');
