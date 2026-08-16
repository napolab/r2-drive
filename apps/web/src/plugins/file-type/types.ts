import type { ObjectDescriptor, Processor } from '@r2-drive/core';
import type { ComponentType } from 'react';

export type IconProps = { readonly size: number };

export type PreviewProps = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

// square preview は Phase 0 の一覧表示で全 file type が持つ必須 renderer。
// Phase 2 の Viewer / Editor capability とは別で、ここではファイルを開かない。
export type FileTypeMatch = {
  readonly typeId: string;
  readonly label: string;
  readonly Icon: ComponentType<IconProps>;
  readonly Preview: ComponentType<PreviewProps>;
};

export type FileTypePlugin = Processor<ObjectDescriptor, FileTypeMatch>;
