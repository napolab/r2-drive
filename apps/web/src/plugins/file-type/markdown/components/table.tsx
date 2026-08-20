import * as styles from './styles.css';

import type { ComponentProps } from 'react';

const MarkdownTable = ({ children }: ComponentProps<'table'>) => <table className={styles.table}>{children}</table>;
const MarkdownTh = ({ children }: ComponentProps<'th'>) => <th className={styles.tableCell}>{children}</th>;
const MarkdownTd = ({ children }: ComponentProps<'td'>) => <td className={styles.tableCell}>{children}</td>;

export const tableComponents = { table: MarkdownTable, th: MarkdownTh, td: MarkdownTd };
