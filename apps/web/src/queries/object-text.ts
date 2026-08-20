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
