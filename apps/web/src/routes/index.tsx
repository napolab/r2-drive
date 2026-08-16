import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getApiClient } from '../api/client';
import { bucketsQuery } from '../queries/buckets';
import * as styles from './index.styles.css';

type BucketLinkProps = { readonly id: string; readonly label: string };

const BucketLink = ({ id, label }: BucketLinkProps) => {
  const params = useMemo(() => ({ bucketId: id, _splat: '' }), [id]);

  return (
    <Link className={styles.item} to="/b/$bucketId/$" params={params}>
      <span className={styles.itemLabel}>{label}</span>
      <span className={styles.itemId}>{id}</span>
    </Link>
  );
};

const RouteComponent = () => {
  const { data } = useSuspenseQuery(bucketsQuery(getApiClient()));

  return (
    <main className={styles.pageRoot}>
      <h1 className={styles.heading}>r2-drive</h1>
      <ul className={styles.listRoot}>
        {data.buckets.map((bucket) => (
          <li key={bucket.id}>
            <BucketLink id={bucket.id} label={bucket.label} />
          </li>
        ))}
      </ul>
    </main>
  );
};

export const Route = createFileRoute('/')({
  // b.$bucketId.$ と同じ理由(そちらのコメント参照)。
  ssr: false,
  loader: ({ context }) => context.queryClient.ensureQueryData(bucketsQuery(getApiClient())),
  pendingComponent: () => <main className={styles.pageRoot}>読み込み中</main>,
  errorComponent: ({ error }) => <main className={styles.pageRoot}>バケット一覧を読み込めませんでした: {error.message}</main>,
  component: RouteComponent,
});
