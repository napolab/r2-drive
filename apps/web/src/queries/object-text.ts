import { queryOptions } from '@tanstack/react-query';

// content URL は etag 付き(?v=)で不変なので、成功したら二度と取り直さない。
export const objectTextQuery = (contentUrl: string) =>
  queryOptions({
    queryKey: ['object-text', contentUrl] as const,
    queryFn: async () => {
      const res = await fetch(contentUrl);
      if (!res.ok) throw new Error(`content fetch failed: ${res.status}`);

      return res.text();
    },
    staleTime: Infinity,
  });

// head preview 用。1 MiB 超のファイルでも全文を fetch せず、Range で先頭 128 KiB だけ取る。
// サーバーが Range を無視して 200 で全文を返しても res.ok は true なのでそのまま動く
// (呼び出し側の headLines がテキスト側で行数を切る)。
const HEAD_PREVIEW_BYTE_RANGE = 'bytes=0-131071'; // 128 KiB

export const objectTextHeadQuery = (contentUrl: string) =>
  queryOptions({
    queryKey: ['object-text-head', contentUrl] as const,
    queryFn: async () => {
      const res = await fetch(contentUrl, { headers: { range: HEAD_PREVIEW_BYTE_RANGE } });
      if (!res.ok) throw new Error(`content head fetch failed: ${res.status}`);

      return res.text();
    },
    staleTime: Infinity,
  });
