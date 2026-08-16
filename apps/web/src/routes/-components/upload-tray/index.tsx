import { useCallback, useMemo } from 'react';
import { Button, ProgressBar } from 'react-aria-components';

import * as styles from './styles.css';

import type { CSSProperties } from 'react';

type PendingUploadTrayItem = { readonly id: string; readonly name: string; readonly progress: number; readonly state: 'queued' | 'uploading' | 'complete' };
type ErrorUploadTrayItem = { readonly id: string; readonly name: string; readonly progress: number; readonly state: 'error'; readonly message: string };
export type UploadTrayItem = PendingUploadTrayItem | ErrorUploadTrayItem;

type Props = { readonly items: readonly UploadTrayItem[]; readonly onCancel: (id: string) => void };

type ProgressStyle = CSSProperties & { readonly '--upload-progress': string };

const stateLabels = {
  queued: '待機中',
  uploading: '送信中',
  error: 'エラー',
  complete: '完了',
} as const satisfies Record<UploadTrayItem['state'], string>;

export const UploadTray = ({ items, onCancel }: Props) => {
  if (items.length === 0) return null;

  return (
    <aside className={styles.root} aria-label="アップロード状況">
      <header className={styles.headerRoot}>
        <h2 className={styles.heading}>UPLOAD QUEUE</h2>
        <span className={styles.count}>{items.length} FILES</span>
      </header>
      <div className={styles.listRoot}>
        {items.map((item) => (
          <UploadTrayRow key={item.id} item={item} onCancel={onCancel} />
        ))}
      </div>
    </aside>
  );
};

type RowProps = { readonly item: UploadTrayItem; readonly onCancel: (id: string) => void };

const UploadTrayRow = ({ item, onCancel }: RowProps) => {
  const handleCancel = useCallback(() => onCancel(item.id), [item.id, onCancel]);
  const progressStyle = useMemo<ProgressStyle>(() => ({ '--upload-progress': `${item.progress}%` }), [item.progress]);
  const actionLabel = item.state === 'queued' || item.state === 'uploading' ? '中断' : '取り除く';

  return (
    <article className={styles.itemRoot} data-state={item.state}>
      <div className={styles.itemMeta}>
        <h3 className={styles.fileName}>{item.name}</h3>
        <span className={styles.state}>{stateLabels[item.state]}</span>
      </div>
      <ProgressBar className={styles.progressRoot} aria-label={`${item.name} の進捗`} minValue={0} maxValue={100} value={item.progress}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={progressStyle} />
        </div>
      </ProgressBar>
      <Button className={styles.cancelButton} onPress={handleCancel} aria-label={`${item.name} を${actionLabel}`}>
        {actionLabel}
      </Button>
      {item.state === 'error' ? <p className={styles.errorMessage}>{item.message}</p> : null}
    </article>
  );
};
