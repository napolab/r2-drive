import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export const getRouter = () => {
  // getRouter() はサーバではリクエストごとに呼ばれる。QueryClient をモジュール
  // トップレベルに置くと利用者間でキャッシュが混ざるので、ここで作る。
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 一度訪れたフォルダへの再訪を即座に描画する(受け入れ基準 2)。
        // この窓の間は再取得せずキャッシュをそのまま出す。
        staleTime: 30_000,
      },
    },
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Link のホバー / フォーカスでルートを先読みする。フォルダ行の先読みは
    // GridListItem 側で queryClient.prefetchInfiniteQuery を直接呼ぶ。
    defaultPreload: 'intent',
  });
};
