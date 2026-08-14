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
