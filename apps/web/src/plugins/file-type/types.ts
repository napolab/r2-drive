import type { ObjectDescriptor, Processor } from '@r2-drive/core';
import type { ComponentType, LazyExoticComponent } from 'react';

export type IconProps = { readonly size: number };

export type PreviewProps = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

export type ViewerProps = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

export type LazyViewer = LazyExoticComponent<ComponentType<ViewerProps>>;

// 「表示だけ」「解釈しない」は 2 つの状態。Editor? という optional は作らない。
// Phase 3 で { kind: 'view-and-edit'; Viewer; Editor } を足すと、capability を
// switch している全消費側がコンパイルエラーになる — それが意図した拡張手順である。
export type FileTypeCapability = { readonly kind: 'opaque' } | { readonly kind: 'view'; readonly Viewer: LazyViewer };

// square preview は Phase 0 の一覧表示で全 file type が持つ必須 renderer。
// Phase 2 の Viewer / Editor capability とは別で、ここではファイルを開かない。
export type FileTypeMatch = {
  readonly typeId: string;
  readonly label: string;
  readonly Icon: ComponentType<IconProps>;
  readonly Preview: ComponentType<PreviewProps>;
  readonly capability: FileTypeCapability;
};

export type FileTypePlugin = Processor<ObjectDescriptor, FileTypeMatch>;
