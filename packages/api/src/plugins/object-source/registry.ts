import { createRunner } from '@r2-drive/core';

import { indexedSource } from './indexed/index';
import { r2ListSource } from './r2-list/index';

import type { ObjectSource } from './types';

// 順序に意味がある(specific → broad)。フォールバックは必ず最後。
export const objectSources = [indexedSource, r2ListSource] as const satisfies readonly ObjectSource[];

export const resolveObjectSource = createRunner(objectSources);
