import type { ObjectDescriptor, Processor } from '@r2-drive/core';

export type ObjectSelection = { readonly actionId: string; readonly objects: readonly ObjectDescriptor[] };

export type ActionDescriptor = {
  readonly actionId: string;
  readonly label: string;
  readonly destructive: boolean;
  run(objects: readonly ObjectDescriptor[]): Promise<void>;
};

export type ObjectAction = Processor<ObjectSelection, ActionDescriptor>;
