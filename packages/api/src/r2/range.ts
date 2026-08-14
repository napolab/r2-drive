import parseRange from 'range-parser';

// 複数レンジ(multipart/byteranges)は非対応。ブラウザの <video> / <audio> は使わない。
export type R2RangeSpec =
  | { readonly kind: 'whole' }
  | { readonly kind: 'offset'; readonly offset: number }
  | { readonly kind: 'window'; readonly offset: number; readonly length: number }
  | { readonly kind: 'suffix'; readonly suffix: number }
  | { readonly kind: 'unsatisfiable' };

export const parseRangeHeader = (header: string | null, size: number): R2RangeSpec => {
  if (header === null) return { kind: 'whole' };

  // range-parser は suffix を解決済みの start/end に正規化するので、
  // 「末尾 N バイト」の意図を保つために先に自前で判定する。
  const suffix = /^bytes=-(\d+)$/.exec(header);
  if (suffix !== null) {
    const n = parseInt(suffix[1] ?? '0', 10);

    return n === 0 ? { kind: 'unsatisfiable' } : { kind: 'suffix', suffix: Math.min(n, size) };
  }

  const parsed = parseRange(size, header, { combine: false });
  if (parsed === -1) return { kind: 'unsatisfiable' };
  if (parsed === -2) return { kind: 'whole' };
  if (parsed.type !== 'bytes' || parsed.length !== 1) return { kind: 'unsatisfiable' };

  const first = parsed[0];
  if (first === undefined) return { kind: 'unsatisfiable' };
  const openEnded = /^bytes=\d+-$/.test(header);

  return openEnded ? { kind: 'offset', offset: first.start } : { kind: 'window', offset: first.start, length: first.end - first.start + 1 };
};

export type ContentRange = { readonly start: number; readonly end: number; readonly length: number; readonly total: number };

// unsatisfiable はここに来る前(ルート側)で 416 として弾かれている前提。
type SatisfiableRangeSpec = Exclude<R2RangeSpec, { readonly kind: 'unsatisfiable' }>;

// spec と size から Content-Range ヘッダに必要な (start, end 込み, length, total) を計算する純関数。
// ルートハンドラの switch にインラインで埋めていたロジックをここへ抽出し、直接単体テストできるようにする。
export const resolveContentRange = (spec: SatisfiableRangeSpec, size: number): ContentRange => {
  switch (spec.kind) {
    case 'whole':
      return { start: 0, end: size - 1, length: size, total: size };
    case 'offset': {
      const length = size - spec.offset;

      return { start: spec.offset, end: spec.offset + length - 1, length, total: size };
    }
    case 'window':
      return { start: spec.offset, end: spec.offset + spec.length - 1, length: spec.length, total: size };
    case 'suffix': {
      const start = size - spec.suffix;

      return { start, end: size - 1, length: spec.suffix, total: size };
    }
    default: {
      const _exhaustive: never = spec;
      throw new Error(`unhandled range spec: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
