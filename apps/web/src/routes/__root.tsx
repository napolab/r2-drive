/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';

import { fontFaceCss } from '../themes/fonts';
import appCss from '../styles.css?url';

import type { ReactNode } from 'react';

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

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'r2-drive' }],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
});
