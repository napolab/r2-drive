import { request } from '@r2-drive/api/client';
import { queryOptions } from '@tanstack/react-query';

import type { ApiClient } from '@r2-drive/api/client';

// objects と同じく queryKey は $url() から作る。パス文字列を二重管理しない。
export const bucketsQuery = (client: ApiClient) => {
  const url = client.buckets.$url();

  return queryOptions({
    queryKey: ['api', url.pathname, url.search] as const,
    queryFn: () =>
      request(() => client.buckets.$get()).match(
        (body) => body,
        (error) => {
          throw error;
        },
      ),
  });
};
