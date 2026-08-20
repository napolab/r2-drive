import { Link } from 'react-aria-components';

import * as styles from './styles.css';

import type { ComponentProps } from 'react';

// react-markdown の `a` を react-aria-components の Link に差し替える(ui rules: リンクは Link を使う)。
// react-aria-components の LinkProps.href は必須(exactOptionalPropertyTypes で undefined を許容しない)。
// href の無い a(まず起こらないが型上はありうる)は Link 化できないため children だけ返す。
const MarkdownLink = ({ href, children }: ComponentProps<'a'>) => {
  if (href === undefined) return children;

  return (
    <Link className={styles.link} href={href}>
      {children}
    </Link>
  );
};

export const linkComponents = { a: MarkdownLink };
