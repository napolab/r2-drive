import { createRunner } from '@r2-drive/core';

import { copyPathAction } from './copy-path/index';
import { deleteAction } from './delete/index';
import { downloadAction } from './download/index';

import type { ObjectAction } from './types';

export const objectActions = [downloadAction, copyPathAction, deleteAction] as const satisfies readonly ObjectAction[];

export const resolveAction = createRunner(objectActions);
