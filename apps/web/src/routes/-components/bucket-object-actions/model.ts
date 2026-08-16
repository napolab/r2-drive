import { getFolderRowId, getObjectRowId } from '../object-list/row-id';

import type { FolderDescriptor, ObjectDescriptor, ObjectPage } from '@r2-drive/core';
import type { InfiniteData } from '@tanstack/react-query';
import type { Key, Selection } from 'react-aria-components';

export type ResolvedSelectedRows = { readonly kind: 'empty' } | { readonly kind: 'contains-folders' } | { readonly kind: 'files'; readonly objects: readonly ObjectDescriptor[] };

export const resolveSelectedRows = (selection: Selection, folders: readonly FolderDescriptor[], objects: readonly ObjectDescriptor[]): ResolvedSelectedRows => {
  if (selection === 'all') {
    if (folders.length > 0) return { kind: 'contains-folders' };
    return objects.length === 0 ? { kind: 'empty' } : { kind: 'files', objects };
  }

  const folderIds = new Set<Key>(folders.map(getFolderRowId));
  const objectsById = new Map<Key, ObjectDescriptor>(objects.map((object) => [getObjectRowId(object), object]));
  const selectedObjects: ObjectDescriptor[] = [];

  for (const key of selection) {
    if (folderIds.has(key)) return { kind: 'contains-folders' };
    const object = objectsById.get(key);
    if (object !== undefined) selectedObjects.push(object);
  }

  return selectedObjects.length === 0 ? { kind: 'empty' } : { kind: 'files', objects: selectedObjects };
};

export const getContextSelection = (
  current: Selection,
  clicked: ObjectDescriptor,
  folders: readonly FolderDescriptor[],
  objects: readonly ObjectDescriptor[],
): { readonly selectedKeys: Set<Key>; readonly objects: readonly ObjectDescriptor[] } => {
  const resolved = resolveSelectedRows(current, folders, objects);
  return getContextSelectionFromResolved(resolved, clicked);
};

const getContextSelectionFromResolved = (resolved: ResolvedSelectedRows, clicked: ObjectDescriptor): { readonly selectedKeys: Set<Key>; readonly objects: readonly ObjectDescriptor[] } => {
  if (resolved.kind === 'files' && resolved.objects.some((object) => getObjectRowId(object) === getObjectRowId(clicked))) {
    return { selectedKeys: new Set(resolved.objects.map(getObjectRowId)), objects: resolved.objects };
  }

  return { selectedKeys: new Set([getObjectRowId(clicked)]), objects: [clicked] };
};

const getObjectIdentity = (object: ObjectDescriptor): string => JSON.stringify([object.bucketId, object.key]);

export const removeObjectsFromPages = (data: InfiniteData<ObjectPage, string | undefined>, selected: readonly ObjectDescriptor[]): InfiniteData<ObjectPage, string | undefined> => {
  const identities = new Set(selected.map(getObjectIdentity));

  return {
    pageParams: data.pageParams,
    pages: data.pages.map((page) => ({ ...page, objects: page.objects.filter((object) => !identities.has(getObjectIdentity(object))) })),
  };
};
