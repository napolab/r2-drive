import { createFileRoute } from '@tanstack/react-router';

import * as styles from './index.styles.css';

export const Route = createFileRoute('/')({
  component: () => <h1 className={styles.root}>r2-drive</h1>,
});
