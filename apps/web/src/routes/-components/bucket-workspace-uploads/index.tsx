import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { addExternalFiles } from '../../../upload/add-external-files/index';
import { toUploadTrayItems } from '../../../upload/to-upload-tray-items/index';
import { ObjectList } from '../object-list/index';
import { UploadPicker } from '../upload-picker/index';
import { useUploaderSession } from '../upload-session-boundary/index';
import { UploadTray } from '../upload-tray/index';
import * as styles from '../../b.$bucketId.$.styles.css';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';
import type { Selection } from 'react-aria-components';

type Props = {
  readonly bucketId: string;
  readonly prefix: string;
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly selectedKeys: Selection;
  readonly onSelectionChange: (keys: Selection) => void;
  readonly onDeleteRequest: () => void;
  readonly onObjectContextMenu: (object: ObjectDescriptor, point: { readonly x: number; readonly y: number }, trigger: HTMLElement) => void;
  readonly actionNotice: ActionNotice;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onPrefetchFolder: (prefix: string) => void;
  readonly onOpenObject: (key: string) => void;
  readonly onLoadMore: () => void;
  readonly isLoadingMore: boolean;
};

export type ActionNotice = { readonly kind: 'none' } | { readonly kind: 'error'; readonly message: string } | { readonly kind: 'success'; readonly message: string };

export const BucketWorkspaceUploads = ({
  bucketId,
  prefix,
  folders,
  objects,
  getContentUrl,
  selectedKeys,
  onSelectionChange,
  onDeleteRequest,
  onObjectContextMenu,
  actionNotice,
  onOpenFolder,
  onPrefetchFolder,
  onOpenObject,
  onLoadMore,
  isLoadingMore,
}: Props) => {
  const uppy = useUploaderSession();
  const subscribe = useCallback((onStoreChange: () => void) => uppy.store.subscribe(() => onStoreChange()), [uppy]);
  const getSnapshot = useCallback(() => uppy.getState(), [uppy]);
  const uploadState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const uploadItems = useMemo(() => toUploadTrayItems(Object.values(uploadState.files)), [uploadState.files]);
  const uploadError = uploadState.info.findLast((info) => info.type === 'error');
  const handleExternalFiles = useCallback((files: readonly File[]) => addExternalFiles({ uppy, files }), [uppy]);
  const handleExternalFileError = useCallback((error: Error) => uppy.info(error.message, 'error'), [uppy]);
  const handleCancelUpload = useCallback((fileId: string) => uppy.removeFile(fileId), [uppy]);

  return (
    <>
      <header className={styles.headerRoot}>
        <div className={styles.headingRoot}>
          <h1 className={styles.heading}>
            {bucketId}/{prefix}
          </h1>
          {uploadError === undefined ? null : (
            <p className={styles.uploadError} role="alert">
              {uploadError.message}
            </p>
          )}
          {actionNotice.kind === 'none' ? null : (
            <p className={styles.actionNotice} data-kind={actionNotice.kind} role="alert">
              {actionNotice.message}
            </p>
          )}
        </div>
        <UploadPicker onFiles={handleExternalFiles} />
      </header>
      <ObjectList
        folders={folders}
        objects={objects}
        getContentUrl={getContentUrl}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        onDeleteRequest={onDeleteRequest}
        onObjectContextMenu={onObjectContextMenu}
        onOpenFolder={onOpenFolder}
        onPrefetchFolder={onPrefetchFolder}
        onOpenObject={onOpenObject}
        onExternalFiles={handleExternalFiles}
        onExternalFileError={handleExternalFileError}
        onLoadMore={onLoadMore}
        isLoadingMore={isLoadingMore}
      />
      <UploadTray items={uploadItems} onCancel={handleCancelUpload} />
    </>
  );
};
