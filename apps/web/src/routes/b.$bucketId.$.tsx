import { useQueryClient, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { getApiClient } from '../api/client';
import { objectsQuery, toPrefix } from '../queries/objects';
import { ObjectList } from './-components/object-list/index';
import * as styles from './b.$bucketId.$.styles.css';

// Task 15 が削除 UI と一緒に配線する。ここでは新しい関数を毎 render 作らないことだけ守る。
const ignoreSelection = () => undefined;

const RouteComponent = () => {
  const { bucketId, _splat } = Route.useParams();
  const prefix = toPrefix(_splat);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(objectsQuery(getApiClient(), bucketId, prefix));

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
      void queryClient.prefetchInfiniteQuery(objectsQuery(getApiClient(), bucketId, next));
    },
    [bucketId, queryClient],
  );

  // カーソルが残っているときだけ次を取る。fetchNextPage は取得中の重複呼び出しを
  // 自分で潰すので、センチネルが何度発火しても 1 回にまとまる。
  const handleLoadMore = useCallback(() => {
    if (hasNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage]);

  return (
    <main className={styles.pageRoot}>
      <h1 className={styles.heading}>
        {bucketId}/{prefix}
      </h1>
      <ObjectList
        folders={folders}
        objects={objects}
        onSelectionChange={ignoreSelection}
        onOpenFolder={handleOpenFolder}
        onPrefetchFolder={handlePrefetchFolder}
        onLoadMore={handleLoadMore}
        isLoadingMore={isFetchingNextPage}
      />
    </main>
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
