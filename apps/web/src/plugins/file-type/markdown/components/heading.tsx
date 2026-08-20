import * as styles from './styles.css';

import type { ComponentProps } from 'react';

const MarkdownH1 = ({ children }: ComponentProps<'h1'>) => <h1 className={styles.h1}>{children}</h1>;
const MarkdownH2 = ({ children }: ComponentProps<'h2'>) => <h2 className={styles.h2}>{children}</h2>;
const MarkdownH3 = ({ children }: ComponentProps<'h3'>) => <h3 className={styles.h3}>{children}</h3>;
// h4-h6 には専用の見出しトークンが無いため、h3 と同じ見た目にする(タグは各階層のまま維持)。
const MarkdownH4 = ({ children }: ComponentProps<'h4'>) => <h4 className={styles.h3}>{children}</h4>;
const MarkdownH5 = ({ children }: ComponentProps<'h5'>) => <h5 className={styles.h3}>{children}</h5>;
const MarkdownH6 = ({ children }: ComponentProps<'h6'>) => <h6 className={styles.h3}>{children}</h6>;

export const headingComponents = {
  h1: MarkdownH1,
  h2: MarkdownH2,
  h3: MarkdownH3,
  h4: MarkdownH4,
  h5: MarkdownH5,
  h6: MarkdownH6,
};
