import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';

export const getFolderRowId = (folder: FolderDescriptor): string => `d:${folder.prefix}`;
export const getObjectRowId = (object: ObjectDescriptor): string => `f:${object.key}`;
