/**
 * Phase 0 受け入れ基準 1(10,000 オブジェクトのフォルダ)の計測用シード。
 *
 * ローカル dev サーバー(vite + @cloudflare/vite-plugin = workerd + ローカル R2)の
 * 実 API 経路(PUT /api/uploads/:bucketId/single)を通してオブジェクトを投入する。
 * R2 binding を直接叩かないのは、計測したいのが「実アプリが通る経路」だから。
 *
 *   node --experimental-strip-types apps/web/scripts/seed-r2.ts
 *   node --experimental-strip-types apps/web/scripts/seed-r2.ts --total=20 --concurrency=5
 *
 * 依存は足さない(Node 組み込みの fetch / crypto のみ)。JPEG も外部ライブラリ無しで
 * baseline JPEG を手で組んでいる(下の "JPEG encoder" 節)。ブラウザが実際にデコードできる
 * バイト列でないと、画像デコードのコストが計測から抜け落ちるため。
 */

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

type SeedConfig = {
  readonly origin: string;
  readonly bucketId: string;
  readonly prefix: string;
  readonly total: number;
  readonly imageRatio: number;
  readonly concurrency: number;
};

const readArg = (name: string): string | undefined => {
  const flag = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(flag));
  if (hit === undefined) return undefined;

  return hit.slice(flag.length);
};

const readOption = (name: string, envName: string): string | undefined => readArg(name) ?? process.env[envName];

const config: SeedConfig = {
  // vite の既定ポート。apps/web の `pnpm dev` は `vite` をそのまま起動する。
  origin: readOption('origin', 'SEED_ORIGIN') ?? 'http://localhost:5173',
  bucketId: readOption('bucket', 'SEED_BUCKET') ?? 'photos',
  prefix: readOption('prefix', 'SEED_PREFIX') ?? 'perf/',
  total: parseInt(readOption('total', 'SEED_TOTAL') ?? '10000', 10),
  imageRatio: parseFloat(readOption('image-ratio', 'SEED_IMAGE_RATIO') ?? '0.3'),
  concurrency: parseInt(readOption('concurrency', 'SEED_CONCURRENCY') ?? '20', 10),
};

const PROGRESS_EVERY = 100;

// ---------------------------------------------------------------------------
// JPEG encoder (baseline, grayscale, standard Huffman tables)
//
// ITU-T T.81 Annex K の標準テーブルだけを使う最小構成。ハフマン最適化も
// クロマ成分も持たない代わりに、ブラウザが問題なくデコードできる。
// ---------------------------------------------------------------------------

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45,
  38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
] as const;

// Annex K.1 の輝度量子化テーブル(品質 50 相当)。
const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
] as const;

// Annex K.3.3.1 の標準ハフマンテーブル(輝度)。BITS は長さ 1..16 の符号語数。
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0] as const;
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d] as const;
const AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24,
  0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53,
  0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93,
  0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
] as const;

// fetch の BodyInit は SharedArrayBuffer 裏付けの view を受け付けないので、
// ArrayBuffer 裏付けであることを型で固定しておく。
type Bytes = Uint8Array<ArrayBuffer>;

type HuffCode = { readonly code: number; readonly length: number };

const buildHuffTable = (bits: readonly number[], vals: readonly number[]): ReadonlyMap<number, HuffCode> => {
  const lengths = bits.flatMap((count, index) => Array.from({ length: count }, () => index + 1));
  if (lengths.length !== vals.length) throw new Error('huffman table mismatch: BITS and HUFFVAL disagree');

  const assigned = lengths.reduce<{ readonly code: number; readonly length: number; readonly entries: readonly (readonly [number, HuffCode])[] }>(
    (acc, length, index) => {
      const value = vals[index];
      if (value === undefined) throw new Error('huffman table mismatch: missing HUFFVAL entry');
      const code = acc.code << (length - acc.length);

      return { code: code + 1, length, entries: [...acc.entries, [value, { code, length }]] };
    },
    { code: 0, length: 0, entries: [] },
  );

  return new Map(assigned.entries);
};

const DC_TABLE = buildHuffTable(DC_BITS, DC_VALS);
const AC_TABLE = buildHuffTable(AC_BITS, AC_VALS);

const R8: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];
// COS[x][u] = cos((2x + 1) u pi / 16)
const COS = R8.map((x) => R8.map((u) => Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
const alpha = (u: number): number => (u === 0 ? Math.SQRT1_2 : 1);

const readAt = <T>(values: readonly T[], index: number): T => {
  const value = values[index];
  if (value === undefined) throw new Error(`index out of range: ${index}`);

  return value;
};

// 1 次元 8 点 DCT-II。2 次元は行 → 列の分離可能形で回す。
const dct1d = (input: readonly number[]): number[] => R8.map((u) => 0.5 * alpha(u) * R8.reduce((sum, x) => sum + readAt(input, x) * readAt(readAt(COS, x), u), 0));

const forwardDCT = (block: readonly number[]): number[] => {
  const rows = R8.flatMap((y) => dct1d(R8.map((x) => readAt(block, y * 8 + x))));
  const cols = R8.map((x) => dct1d(R8.map((y) => readAt(rows, y * 8 + x))));

  return R8.flatMap((y) => R8.map((x) => readAt(readAt(cols, x), y)));
};

const quantizeToZigzag = (coefficients: readonly number[]): number[] => ZIGZAG.map((natural) => Math.round(readAt(coefficients, natural) / readAt(LUMA_QUANT, natural)));

const magnitudeBits = (value: number): number => (value === 0 ? 0 : 32 - Math.clz32(Math.abs(value)));
const signedBits = (value: number, size: number): number => (value >= 0 ? value : value + (1 << size) - 1);

// エントロピー符号化はビット列を順に積む処理そのものなので、可変状態を
// このクラスの private field に閉じ込める(外に let を漏らさない)。
class BitWriter {
  #bytes: number[] = [];
  #accumulator = 0;
  #filled = 0;

  writeBits(code: number, length: number): void {
    for (const offset of Array.from({ length }, (_, index) => length - 1 - index)) {
      this.#writeBit((code >> offset) & 1);
    }
  }

  writeCode(table: ReadonlyMap<number, HuffCode>, symbol: number): void {
    const entry = table.get(symbol);
    if (entry === undefined) throw new Error(`no huffman code for symbol: ${symbol}`);
    this.writeBits(entry.code, entry.length);
  }

  // 残りを 1 で埋めて終端する(T.81 F.1.2.3)。
  finish(): Uint8Array {
    if (this.#filled > 0) this.writeBits(0xff, 8 - this.#filled);

    return Uint8Array.from(this.#bytes);
  }

  #writeBit(bit: number): void {
    this.#accumulator = ((this.#accumulator << 1) | bit) & 0xff;
    this.#filled += 1;
    if (this.#filled < 8) return;

    this.#bytes.push(this.#accumulator);
    // 0xFF はマーカーの先頭バイトなので、エントロピー符号内では 0x00 を詰めて逃がす。
    if (this.#accumulator === 0xff) this.#bytes.push(0x00);
    this.#accumulator = 0;
    this.#filled = 0;
  }
}

const writeAcRun = (writer: BitWriter, run: number, value: number): void => {
  for (const _zrl of Array.from({ length: Math.floor(run / 16) })) {
    writer.writeCode(AC_TABLE, 0xf0);
  }
  const size = magnitudeBits(value);
  writer.writeCode(AC_TABLE, ((run % 16) << 4) | size);
  writer.writeBits(signedBits(value, size), size);
};

const encodeBlock = (writer: BitWriter, zigzag: readonly number[], previousDC: number): number => {
  const dc = readAt(zigzag, 0);
  const diff = dc - previousDC;
  const dcSize = magnitudeBits(diff);
  writer.writeCode(DC_TABLE, dcSize);
  if (dcSize > 0) writer.writeBits(signedBits(diff, dcSize), dcSize);

  const ac = zigzag.slice(1);
  const last = ac.findLastIndex((value) => value !== 0);
  if (last === -1) {
    writer.writeCode(AC_TABLE, 0x00);

    return dc;
  }

  ac.slice(0, last + 1).reduce((run, value) => {
    if (value === 0) return run + 1;
    writeAcRun(writer, run, value);

    return 0;
  }, 0);
  if (last < ac.length - 1) writer.writeCode(AC_TABLE, 0x00);

  return dc;
};

const segment = (marker: number, payload: readonly number[]): number[] => {
  const length = payload.length + 2;

  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
};

const jpegHeader = (width: number, height: number): number[] => [
  0xff,
  0xd8,
  ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  // DQT は zigzag 順で書く。
  ...segment(0xdb, [0x00, ...ZIGZAG.map((natural) => readAt(LUMA_QUANT, natural))]),
  // SOF0: 8bit / 1 成分(グレースケール)/ サンプリング 1x1 / 量子化テーブル 0。
  ...segment(0xc0, [0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x11, 0x00]),
  ...segment(0xc4, [0x00, ...DC_BITS, ...DC_VALS]),
  ...segment(0xc4, [0x10, ...AC_BITS, ...AC_VALS]),
  // SOS: 成分 1 / DC=0 AC=0 テーブル / Ss=0 Se=63 Ah=Al=0。
  ...segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
];

// 白色ノイズは実写より遥かに非圧縮でサイズが暴れるので、低周波の模様に
// 少量のノイズを載せて「写真並みの bit/pixel」に寄せる。
const samplePixel = (x: number, y: number): number => {
  const wave = 70 * Math.sin(x / 23) * Math.cos(y / 31) + 40 * Math.sin((x + y) / 11) + 25 * Math.sin((x - 2 * y) / 47);
  const grain = 21 * Math.sin(x * 12.9898 + y * 78.233) * Math.cos(x * 4.898 + y * 7.23);

  return Math.max(0, Math.min(255, Math.round(128 + wave + grain)));
};

const encodeJpeg = (width: number, height: number): Bytes => {
  if (width % 8 !== 0 || height % 8 !== 0) throw new Error('jpeg dimensions must be multiples of 8');
  const blocksX = width / 8;
  const blocksY = height / 8;
  const writer = new BitWriter();

  Array.from({ length: blocksX * blocksY }, (_, index) => index).reduce((previousDC, index) => {
    const originX = (index % blocksX) * 8;
    const originY = Math.floor(index / blocksX) * 8;
    const block = R8.flatMap((y) => R8.map((x) => samplePixel(originX + x, originY + y) - 128));

    return encodeBlock(writer, quantizeToZigzag(forwardDCT(block)), previousDC);
  }, 0);

  const scan = writer.finish();
  const header = jpegHeader(width, height);
  const bytes = new Uint8Array(header.length + scan.length + 2);
  bytes.set(header, 0);
  bytes.set(scan, header.length);
  bytes.set([0xff, 0xd9], header.length + scan.length);

  return bytes;
};

// この寸法 + samplePixel の grain 振幅 21 で実測 125,132 bytes(約 122KB)。
// どちらを動かしてもサイズは大きく動くので、狙いを変えるときは実測し直すこと。
const JPEG_WIDTH = 1280;
const JPEG_HEIGHT = 960;

// ---------------------------------------------------------------------------
// payload / key の組み立て
// ---------------------------------------------------------------------------

// キーの長短を混ぜる。等幅で組んだ一覧の列幅やテキストの折り返しは、
// 全部同じ長さのキーだと計測できない。
const NAMES = ['a', 'shot', 'sunset', 'field-note', 'kitchen-table', 'archive-2019-summer', 'very-long-object-name-that-wraps-in-narrow-viewports', 'b', 'draft', 'meeting-notes-final-v2'] as const;

const randomBytes = (size: number): Bytes => crypto.getRandomValues(new Uint8Array(size));

type SeedItem = { readonly key: string; readonly contentType: string; readonly body: Bytes };

const buildItem = (index: number, jpeg: Bytes): SeedItem => {
  const label = NAMES[index % NAMES.length];
  if (label === undefined) throw new Error('NAMES must not be empty');
  const serial = `${index}`.padStart(5, '0');
  // 画像は 10 件おきに均等に散らす(まとまっていると 1 ビューポートあたりの帯域が測れない)。
  const isImage = index % 10 < Math.round(config.imageRatio * 10);
  if (isImage) {
    return { key: `${config.prefix}${serial}-${label}.jpg`, contentType: 'image/jpeg', body: jpeg };
  }

  return { key: `${config.prefix}${serial}-${label}.bin`, contentType: 'application/octet-stream', body: randomBytes(256 + (index % 7) * 64) };
};

// ---------------------------------------------------------------------------
// 投入
// ---------------------------------------------------------------------------

const uploadItem = async (item: SeedItem): Promise<void> => {
  const url = `${config.origin}/api/uploads/${config.bucketId}/single?key=${encodeURIComponent(item.key)}`;
  const response = await fetch(url, { method: 'PUT', headers: { 'content-type': item.contentType }, body: item.body });
  const text = await response.text();
  // 握り潰さない。10,000 件のうち数件が黙って落ちると計測そのものが嘘になる。
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`upload failed: ${response.status} ${response.statusText} key=${item.key} body=${text}`);
  }
};

const formatProgress = (done: number, total: number, startedAt: number): string => {
  const elapsed = (Date.now() - startedAt) / 1000;
  const perSecond = done / Math.max(elapsed, 0.001);
  const remaining = (total - done) / Math.max(perSecond, 0.001);

  return `seed ${done}/${total} elapsed=${elapsed.toFixed(1)}s rate=${perSecond.toFixed(1)}/s eta=${remaining.toFixed(1)}s`;
};

const seed = async (): Promise<void> => {
  process.stderr.write(`seed: generating jpeg ${JPEG_WIDTH}x${JPEG_HEIGHT}\n`);
  const jpeg = encodeJpeg(JPEG_WIDTH, JPEG_HEIGHT);
  process.stderr.write(`seed: jpeg ${jpeg.byteLength} bytes\n`);
  process.stderr.write(`seed: target ${config.origin}/api/uploads/${config.bucketId}/single prefix=${config.prefix} total=${config.total} concurrency=${config.concurrency}\n`);

  const startedAt = Date.now();
  const chunks = Array.from({ length: Math.ceil(config.total / config.concurrency) }, (_, index) => index * config.concurrency);

  for (const offset of chunks) {
    const indexes = Array.from({ length: Math.min(config.concurrency, config.total - offset) }, (_, index) => offset + index);
    await Promise.all(indexes.map(async (index) => uploadItem(buildItem(index, jpeg))));

    const done = offset + indexes.length;
    if (Math.floor(done / PROGRESS_EVERY) > Math.floor(offset / PROGRESS_EVERY)) {
      process.stderr.write(`${formatProgress(done, config.total, startedAt)}\n`);
    }
  }

  process.stderr.write(`${formatProgress(config.total, config.total, startedAt)} done\n`);
};

try {
  await seed();
} catch (error) {
  process.stderr.write(`seed: aborted\n${error instanceof Error ? (error.stack ?? error.message) : `${error}`}\n`);
  process.exit(1);
}

// top-level await を使うため、この 1 行でモジュール扱いにする(TS1375)。
export {};
