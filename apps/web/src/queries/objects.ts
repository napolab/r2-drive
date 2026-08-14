import { request } from '@r2-drive/api/client';
import { infiniteQueryOptions } from '@tanstack/react-query';

import type { ApiClient } from '@r2-drive/api/client';

// R2 の「フォルダ」は末尾が '/' の共通接頭辞でしかない(core/object-descriptor.ts)。
// ところが TanStack Router の splat は URL から末尾の '/' を落として返すため、
// '/b/photos/trips/' を開くと _splat は 'trips' になる。そのまま list に渡すと
// delimiter 付き list が 'trips/' を「配下のフォルダ」として返し、同じ画面に
// 同じフォルダが出続ける(実際に開発サーバーで踏んだ)。URL → 接頭辞の境界で直す。
export const toPrefix = (splat: string | undefined): string => {
  if (splat === undefined || splat === '') return '';

  return splat.endsWith('/') ? splat : `${splat}/`;
};

// queryKey は $url() から作る。パス文字列を二重管理しない。
// hc の $url() は絶対 URL を返すが、キーには pathname / search だけを使う
// (origin はブラウザと SSR で異なりうるので、キーに混ぜるとキャッシュが分裂する)。
export const objectsQuery = (client: ApiClient, bucketId: string, prefix: string) => {
  const url = client.buckets[':bucketId'].objects.$url({ param: { bucketId }, query: { prefix } });

  return infiniteQueryOptions({
    queryKey: ['api', url.pathname, url.search] as const,
    initialPageParam: undefined as string | undefined,
    // TanStack Query の queryFn が Result チェーンの消費エッジ。ここでだけ .match して
    // throw に落とす(rejected promise が Query の error チャンネルになる)。
    queryFn: ({ pageParam }) =>
      request(() =>
        // exactOptionalPropertyTypes: true なので `cursor: undefined` を渡せない。
        // 1 ページ目はキーごと落とす。
        pageParam === undefined
          ? client.buckets[':bucketId'].objects.$get({ param: { bucketId }, query: { prefix } })
          : client.buckets[':bucketId'].objects.$get({ param: { bucketId }, query: { prefix, cursor: pageParam } }),
      ).match(
        (page) => page,
        (error) => {
          throw error;
        },
      ),
    getNextPageParam: (last) => (last.next.kind === 'more' ? last.next.cursor : undefined),
  });
};
