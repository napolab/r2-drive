import type { ObjectDescriptor, Processor } from '@r2-drive/core';
import type { ComponentType } from 'react';

export type IconProps = { readonly size: number };

// Phase 2 で capability(Viewer / Editor)を足す。今は実装が 0 個なので作らない。
export type FileTypeMatch = {
  readonly typeId: string;
  readonly label: string;
  readonly Icon: ComponentType<IconProps>;
};

export type FileTypePlugin = Processor<ObjectDescriptor, FileTypeMatch>;
