import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { objectsQuery } from '../../../queries/objects';
import { resolveAction } from '../../../plugins/object-action/registry';
import { BucketWorkspaceUploads } from '../bucket-workspace-uploads/index';
import { DeleteDialog } from '../delete-dialog/index';
import { ObjectContextMenu } from '../object-context-menu/index';
import { getContextSelection, removeObjectsFromPages, resolveSelectedRows } from './model';

import type { ApiClient } from '@r2-drive/api/client';
import type { FolderDescriptor, ObjectDescriptor, ObjectPage } from '@r2-drive/core';
import type { InfiniteData } from '@tanstack/react-query';
import type { Key, Selection } from 'react-aria-components';
import type { ActionDescriptor } from '../../../plugins/object-action/types';
import type { ActionNotice } from '../bucket-workspace-uploads/index';
import type { DeleteDialogState } from '../delete-dialog/index';
import type { ObjectContextMenuState } from '../object-context-menu/index';

type Props = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly prefix: string;
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onOpenFolder: (prefix: string) => void;
  readonly onPrefetchFolder: (prefix: string) => void;
  readonly onOpenObject: (key: string) => void;
  readonly onLoadMore: () => void;
  readonly isLoadingMore: boolean;
};

type DeleteVariables = { readonly action: ActionDescriptor; readonly objects: readonly ObjectDescriptor[] };
type DeleteContext = { readonly kind: 'absent' } | { readonly kind: 'snapshot'; readonly data: InfiniteData<ObjectPage, string | undefined> };
// key だけを保持する。descriptor(ObjectDescriptor[])は使う瞬間に現在の folders/objects
// から再解決する — でないと selection が起きた時点の props に固まったまま、
// 後から届いた行(fetchNextPage)や folder に追従できない。
type ContextMenuAnchor = { readonly kind: 'closed' } | { readonly kind: 'open'; readonly keys: Set<Key>; readonly point: { readonly x: number; readonly y: number }; readonly trigger: HTMLElement };

class ObjectActionInvariantError extends Error {
  override name = 'ObjectActionInvariantError';
}

const getActionDescriptor = (actionId: string, objects: readonly ObjectDescriptor[]): ActionDescriptor =>
  resolveAction({ actionId, objects }).match(
    (descriptor) => descriptor,
    () => {
      throw new ObjectActionInvariantError(`object action is not registered: ${actionId}`);
    },
  );

const getDialogObjects = (state: DeleteDialogState): readonly ObjectDescriptor[] => {
  switch (state.kind) {
    case 'closed':
      return [];
    case 'ready':
    case 'deleting':
    case 'error':
      return state.objects;
  }
};

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'ファイル操作に失敗しました');

export const BucketObjectActions = ({ client, bucketId, prefix, folders, objects, getContentUrl, onOpenFolder, onPrefetchFolder, onOpenObject, onLoadMore, isLoadingMore }: Props) => {
  const queryClient = useQueryClient();
  const queryKey = objectsQuery(client, bucketId, prefix).queryKey;
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuAnchor>({ kind: 'closed' });
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({ kind: 'closed' });
  const [actionNotice, setActionNotice] = useState<ActionNotice>({ kind: 'none' });

  // メニューが開いている間に folders/objects が変わっても(行が消える、folder が届く)
  // 追従できるよう、objects の配列そのものは持たず render のたびに再解決する。
  const contextMenuState = useMemo<ObjectContextMenuState>(() => {
    if (contextMenu.kind !== 'open') return { kind: 'closed' };
    const resolved = resolveSelectedRows(contextMenu.keys, folders, objects);
    if (resolved.kind !== 'files') return { kind: 'closed' };
    return { kind: 'open', objects: resolved.objects, point: contextMenu.point, trigger: contextMenu.trigger };
  }, [contextMenu, folders, objects]);

  const deleteMutation = useMutation<void, unknown, DeleteVariables, DeleteContext>({
    mutationFn: ({ action, objects: selectedObjects }) => action.run(selectedObjects),
    onMutate: async ({ objects: selectedObjects }) => {
      setDeleteDialog({ kind: 'deleting', objects: selectedObjects });
      setActionNotice({ kind: 'none' });
      await queryClient.cancelQueries({ queryKey, exact: true });
      const snapshot = queryClient.getQueryData<InfiniteData<ObjectPage, string | undefined>>(queryKey);
      if (snapshot === undefined) return { kind: 'absent' };
      queryClient.setQueryData(queryKey, removeObjectsFromPages(snapshot, selectedObjects));
      return { kind: 'snapshot', data: snapshot };
    },
    onError: (error, variables, context) => {
      if (context?.kind === 'snapshot') queryClient.setQueryData(queryKey, context.data);
      setDeleteDialog({ kind: 'error', objects: variables.objects, message: getErrorMessage(error) });
    },
    onSuccess: (_data, variables) => {
      setDeleteDialog({ kind: 'closed' });
      setSelectedKeys(new Set());
      setActionNotice({ kind: 'success', message: `${variables.objects.length} 件を削除しました` });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });

  const handleSelectionChange = useCallback((keys: Selection) => setSelectedKeys(keys), []);
  // 呼ばれた瞬間の folders/objects で解決する。select all の後にページが増えても
  // 最新の全行が対象になり、後から届いた folder があれば contains-folders に倒れる。
  const handleDeleteRequest = useCallback(() => {
    const selection = resolveSelectedRows(selectedKeys, folders, objects);
    switch (selection.kind) {
      case 'empty':
        return;
      case 'contains-folders':
        setActionNotice({ kind: 'error', message: 'フォルダの削除は Phase 0 では対応していません' });
        return;
      case 'files':
        setActionNotice({ kind: 'none' });
        setDeleteDialog({ kind: 'ready', objects: selection.objects });
    }
  }, [selectedKeys, folders, objects]);

  const handleObjectContextMenu = useCallback(
    (object: ObjectDescriptor, point: { readonly x: number; readonly y: number }, trigger: HTMLElement) => {
      const selection = getContextSelection(selectedKeys, object, folders, objects);
      setSelectedKeys(selection.selectedKeys);
      setActionNotice({ kind: 'none' });
      setContextMenu({ kind: 'open', keys: selection.selectedKeys, point, trigger });
    },
    [selectedKeys, folders, objects],
  );
  const handleContextMenuClose = useCallback(() => setContextMenu({ kind: 'closed' }), []);
  const handleContextAction = useCallback(
    (action: ActionDescriptor) => {
      if (contextMenuState.kind !== 'open') return;
      const selectedObjects = contextMenuState.objects;
      setContextMenu({ kind: 'closed' });

      if (action.actionId === 'delete') {
        setDeleteDialog({ kind: 'ready', objects: selectedObjects });
        return;
      }

      const runAction = async () => {
        try {
          await action.run(selectedObjects);
          setActionNotice({ kind: 'success', message: `${action.label}を完了しました` });
        } catch (error) {
          setActionNotice({ kind: 'error', message: getErrorMessage(error) });
        }
      };
      void runAction();
    },
    [contextMenuState],
  );
  const handleDeleteConfirm = useCallback(() => {
    const selectedObjects = getDialogObjects(deleteDialog);
    if (selectedObjects.length === 0 || deleteDialog.kind === 'deleting') return;
    deleteMutation.mutate({ action: getActionDescriptor('delete', selectedObjects), objects: selectedObjects });
  }, [deleteDialog, deleteMutation]);
  const handleDeleteCancel = useCallback(() => setDeleteDialog({ kind: 'closed' }), []);

  return (
    <>
      <BucketWorkspaceUploads
        bucketId={bucketId}
        prefix={prefix}
        folders={folders}
        objects={objects}
        getContentUrl={getContentUrl}
        selectedKeys={selectedKeys}
        onSelectionChange={handleSelectionChange}
        onDeleteRequest={handleDeleteRequest}
        onObjectContextMenu={handleObjectContextMenu}
        actionNotice={actionNotice}
        onOpenFolder={onOpenFolder}
        onPrefetchFolder={onPrefetchFolder}
        onOpenObject={onOpenObject}
        onLoadMore={onLoadMore}
        isLoadingMore={isLoadingMore}
      />
      <ObjectContextMenu state={contextMenuState} onAction={handleContextAction} onClose={handleContextMenuClose} />
      <DeleteDialog state={deleteDialog} onConfirm={handleDeleteConfirm} onCancel={handleDeleteCancel} />
    </>
  );
};
