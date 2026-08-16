import { useCallback } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import * as styles from './styles.css';

import type { ObjectDescriptor } from '@r2-drive/core';

export type DeleteDialogState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'ready'; readonly objects: readonly ObjectDescriptor[] }
  | { readonly kind: 'deleting'; readonly objects: readonly ObjectDescriptor[] }
  | { readonly kind: 'error'; readonly objects: readonly ObjectDescriptor[]; readonly message: string };

type Props = {
  readonly state: DeleteDialogState;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

const getObjects = (state: DeleteDialogState): readonly ObjectDescriptor[] => {
  switch (state.kind) {
    case 'closed':
      return [];
    case 'ready':
    case 'deleting':
    case 'error':
      return state.objects;
  }
};

export const DeleteDialog = ({ state, onConfirm, onCancel }: Props) => {
  const isDeleting = state.kind === 'deleting';
  const objects = getObjects(state);
  const remainingCount = Math.max(objects.length - 5, 0);
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen && !isDeleting) onCancel();
    },
    [isDeleting, onCancel],
  );

  return (
    <ModalOverlay className={styles.overlay} isOpen={state.kind !== 'closed'} isDismissable={!isDeleting} onOpenChange={handleOpenChange}>
      <Modal className={styles.modalRoot}>
        <Dialog className={styles.dialogRoot} role="alertdialog">
          <Heading className={styles.heading} slot="title">
            {objects.length} 件を削除しますか
          </Heading>
          <p className={styles.warning}>この操作は元に戻せません。</p>
          <ul className={styles.listRoot}>
            {objects.slice(0, 5).map((object) => (
              <li key={`${object.bucketId}:${object.key}`} className={styles.listItem}>
                {object.name}
              </li>
            ))}
          </ul>
          {remainingCount === 0 ? null : <p className={styles.remainder}>ほか {remainingCount} 件</p>}
          {state.kind === 'error' ? (
            <p className={styles.error} role="alert">
              {state.message}
            </p>
          ) : null}
          <div className={styles.actionsRoot}>
            <Button className={styles.button} autoFocus isDisabled={isDeleting} onPress={onCancel}>
              キャンセル
            </Button>
            <Button className={styles.dangerButton} isDisabled={isDeleting} onPress={onConfirm}>
              {isDeleting ? '削除中' : state.kind === 'error' ? '削除を再試行' : '削除'}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
};
