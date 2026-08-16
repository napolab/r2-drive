import { useQueryClient, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { getApiClient } from '../api/client';
import { objectsQuery, toPrefix } from '../queries/objects';
import { BucketObjectActions } from './-components/bucket-object-actions/index';
import { BucketUploadSession } from './-components/bucket-upload-session/index';
import * as styles from './b.$bucketId.$.styles.css';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';

const getContentUrl = (object: ObjectDescriptor): string => {
  const client = getApiClient();
  return client.buckets[':bucketId'].content[':path{.+}'].$url({ param: { bucketId: object.bucketId, path: object.key } }).toString();
};

const RouteComponent = () => {
  const { bucketId, _splat } = Route.useParams();
  const prefix = toPrefix(_splat);
  const client = getApiClient();

  return (
    <main className={styles.pageRoot}>
      <BucketUploadSession client={client} bucketId={bucketId} prefix={prefix}>
        <BucketWorkspace client={client} bucketId={bucketId} prefix={prefix} />
      </BucketUploadSession>
    </main>
  );
};

type BucketWorkspaceProps = { readonly client: ApiClient; readonly bucketId: string; readonly prefix: string };

const BucketWorkspace = ({ client, bucketId, prefix }: BucketWorkspaceProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(objectsQuery(client, bucketId, prefix));

  const folders = useMemo(() => data.pages.flatMap((page) => page.folders), [data.pages]);
  const objects = useMemo(() => data.pages.flatMap((page) => page.objects), [data.pages]);

  const handleOpenFolder = useCallback(
    (next: string) => {
      void navigate({ to: '/b/$bucketId/$', params: { bucketId, _splat: next } });
    },
    [bucketId, navigate],
  );

  // ホバー / フォーカスの時点で取っておく。戻ってきたときは staleTime の窓内なので
  // ネットワークを待たずに描画される(受け入れ基準 2)。
  const handlePrefetchFolder = useCallback(
    (next: string) => {
      void queryClient.prefetchInfiniteQuery(objectsQuery(client, bucketId, next));
    },
    [bucketId, client, queryClient],
  );

  // カーソルが残っているときだけ次を取る。fetchNextPage は取得中の重複呼び出しを
  // 自分で潰すので、センチネルが何度発火しても 1 回にまとまる。
  const handleLoadMore = useCallback(() => {
    if (hasNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage]);

  return (
    <BucketObjectActions
      client={client}
      bucketId={bucketId}
      prefix={prefix}
      folders={folders}
      objects={objects}
      getContentUrl={getContentUrl}
      onOpenFolder={handleOpenFolder}
      onPrefetchFolder={handlePrefetchFolder}
      onLoadMore={handleLoadMore}
      isLoadingMore={isFetchingNextPage}
    />
  );
};

export const Route = createFileRoute('/b/$bucketId/$')({
  // getApiClient() は location.origin から baseUrl を作るのでブラウザ専用。
  // SSR で一覧を取るには内部リクエストの組み立て(元リクエストのヘッダ引き継ぎを含む)が
  // 要るが、それは Access を 2 度通す往復を足すことになる。Phase 0 の受け入れ基準は
  // どれも SSR を要求しないので、このルートはクライアント描画に倒す(report 参照)。
  ssr: false,
  loader: ({ context, params }) => context.queryClient.ensureInfiniteQueryData(objectsQuery(getApiClient(), params.bucketId, toPrefix(params._splat))),
  // suspend するのはこのルートのコンポーネントそのもの(= 一覧)なので、
  // 境界はルート単位で過不足がない。TanStack Router が errorComponent の内側に
  // pendingComponent の Suspense を張る。
  pendingComponent: () => <main className={styles.pageRoot}>読み込み中</main>,
  errorComponent: ({ error }) => <main className={styles.pageRoot}>一覧を読み込めませんでした: {error.message}</main>,
  component: RouteComponent,
});
