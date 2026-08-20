import { useQueryClient, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { getApiClient } from '../api/client';
import { objectsQuery, toPrefix } from '../queries/objects';
import { BucketObjectActions } from './-components/bucket-object-actions/index';
import { BucketUploadSession } from './-components/bucket-upload-session/index';
import { isGalleryImage } from './-components/gallery/index';
import { resolveViewMode } from './-components/gallery/resolve-view-mode';
import { ObjectViewerOverlay } from './-components/object-viewer/index';
import * as styles from './b.$bucketId.$.styles.css';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';
import type { ViewMode } from './-components/gallery/resolve-view-mode';
import type { ViewerRequest } from './-components/object-viewer/index';

// URL search は「無い」状態が正当なので optional。variant への変換は useSearch 直後に行い、
// optional をコンポーネント境界より内側に持ち込まない。gallery は無指定で表す
// (既定値を URL に書かない) — `mode` は 'tiles' の存在だけが意味を持つ。
const viewerSearchSchema = z.object({ view: z.string().optional(), mode: z.enum(['tiles']).optional() });

// content-addressed URL。etag を ?v= に載せることで、サーバが「この URL は
// この中身しか指さない」と判断でき immutable を返せる(戻るたびの再ダウンロードを消す)。
// 上書きされれば etag が変わり URL も変わるので stale にならない。
const getContentUrl = (object: ObjectDescriptor): string => {
  const client = getApiClient();
  return client.buckets[':bucketId'].content[':path{.+}'].$url({ param: { bucketId: object.bucketId, path: object.key }, query: { v: object.etag } }).toString();
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

  const { view, mode } = Route.useSearch();
  const viewerRequest: ViewerRequest = useMemo(() => (view === undefined ? { kind: 'closed' } : { kind: 'open', objectKey: view }), [view]);
  // 画像が 1 件も無いフォルダはギャラリーにしても空の帯にしかならないので、
  // 無指定でも自動的にタイルへ落ちる(resolveViewMode)。
  const viewMode = useMemo(() => resolveViewMode(mode, objects.some(isGalleryImage)), [mode, objects]);

  // 関数形の search updater で前の値(mode / view)を保ったまま片方だけ書き換える。
  // オブジェクトリテラルで置き換えると、view を開いた瞬間に mode が消えて
  // ビューアを閉じたときギャラリーへ戻ってしまう(逆方向も同様)。
  const handleOpenObject = useCallback(
    (key: string) => {
      void navigate({ to: '.', search: (prev) => ({ ...prev, view: key }) });
    },
    [navigate],
  );

  const handleCloseViewer = useCallback(() => {
    void navigate({ to: '.', search: (prev) => ({ ...prev, view: undefined }) });
  }, [navigate]);

  // replace: 50 枚めくった履歴を 50 回戻らせない。戻る 1 回で overlay ごと閉じる。
  const handleNavigateViewer = useCallback(
    (key: string) => {
      void navigate({ to: '.', search: (prev) => ({ ...prev, view: key }), replace: true });
    },
    [navigate],
  );

  // トグルは履歴に残す(replace: false)。view は触らない — 表示モードを
  // 切り替えてもビューアが開いていれば開いたままにする。
  const handleViewModeChange = useCallback(
    (next: ViewMode) => {
      void navigate({ to: '.', search: (prev) => ({ ...prev, mode: next === 'tiles' ? 'tiles' : undefined }), replace: false });
    },
    [navigate],
  );

  return (
    <>
      <BucketObjectActions
        client={client}
        bucketId={bucketId}
        prefix={prefix}
        folders={folders}
        objects={objects}
        getContentUrl={getContentUrl}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onOpenFolder={handleOpenFolder}
        onPrefetchFolder={handlePrefetchFolder}
        onOpenObject={handleOpenObject}
        onLoadMore={handleLoadMore}
        isLoadingMore={isFetchingNextPage}
      />
      <ObjectViewerOverlay client={client} bucketId={bucketId} objects={objects} request={viewerRequest} getContentUrl={getContentUrl} onClose={handleCloseViewer} onNavigate={handleNavigateViewer} />
    </>
  );
};

export const Route = createFileRoute('/b/$bucketId/$')({
  // getApiClient() は location.origin から baseUrl を作るのでブラウザ専用。
  // SSR で一覧を取るには内部リクエストの組み立て(元リクエストのヘッダ引き継ぎを含む)が
  // 要るが、それは Access を 2 度通す往復を足すことになる。Phase 0 の受け入れ基準は
  // どれも SSR を要求しないので、このルートはクライアント描画に倒す(report 参照)。
  ssr: false,
  validateSearch: (search) => viewerSearchSchema.parse(search),
  loader: ({ context, params }) => context.queryClient.ensureInfiniteQueryData(objectsQuery(getApiClient(), params.bucketId, toPrefix(params._splat))),
  // suspend するのはこのルートのコンポーネントそのもの(= 一覧)なので、
  // 境界はルート単位で過不足がない。TanStack Router が errorComponent の内側に
  // pendingComponent の Suspense を張る。
  pendingComponent: () => <main className={styles.pageRoot}>読み込み中</main>,
  errorComponent: ({ error }) => <main className={styles.pageRoot}>一覧を読み込めませんでした: {error.message}</main>,
  component: RouteComponent,
});
