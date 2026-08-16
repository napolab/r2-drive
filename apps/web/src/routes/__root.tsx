/// <reference types="vite/client" />
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';

import { fontFaceCss } from '../themes/fonts';
import appCss from '../styles.css?url';

import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// router.tsx が createRouter({ context }) に渡す型。ルート側の loader は
// `context.queryClient` をここ経由で型付きで受け取る。
export type RouterContext = { readonly queryClient: QueryClient };

const RootDocument = ({ children }: { readonly children: ReactNode }) => (
  <html lang="ja">
    <head>
      <HeadContent />
      <style>{fontFaceCss}</style>
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

// loader は router context 経由で QueryClient を触れるが、コンポーネント側の
// useSuspenseInfiniteQuery は Provider を要求する。同じインスタンスを配る。
const RootComponent = () => {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'r2-drive' }],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});
