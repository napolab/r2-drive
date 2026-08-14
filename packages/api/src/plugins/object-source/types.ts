import type { DriveError, ObjectPage, Prefix, Processor } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

export type ListRequest = { readonly env: Env; readonly bucketId: string; readonly prefix: Prefix; readonly cursor: string | undefined };

// ディスパッチは同期(どのソースが担当するか)、仕事は非同期。
export type ObjectSource = Processor<ListRequest, ResultAsync<ObjectPage, DriveError>>;
