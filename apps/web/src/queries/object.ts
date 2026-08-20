import { request } from '@r2-drive/api/client';
import { queryOptions } from '@tanstack/react-query';

import type { ApiClient } from '@r2-drive/api/client';

// deep link(?view=<key>)で一覧に居ない descriptor を 1 件だけ取る。
export const objectQuery = (client: ApiClient, bucketId: string, key: string) => {
  const url = client.buckets[':bucketId'].objects[':path{.+}'].$url({ param: { bucketId, path: key } });

  return queryOptions({
    queryKey: ['api', url.pathname, url.search] as const,
    queryFn: () =>
      request(() => client.buckets[':bucketId'].objects[':path{.+}'].$get({ param: { bucketId, path: key } })).match(
        (descriptor) => descriptor,
        (error) => {
          throw error;
        },
      ),
    // 存在しない key はリトライしても見つからないので即座に not-found を出す。
    // デフォルトの 3 回リトライ(指数バックオフ)は typo'd ?view= のディープリンクで
    // 数秒間「読み込み中」を表示し続ける原因になっていた。
    retry: false,
  });
};
