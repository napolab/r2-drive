import { createRunner } from '@r2-drive/core';

import { r2ListSource } from './r2-list/index';

import type { ObjectSource } from './types';

// Phase 1 で indexedSource をこの前に挿す。
export const objectSources = [r2ListSource] as const satisfies readonly ObjectSource[];

export const resolveObjectSource = createRunner(objectSources);
