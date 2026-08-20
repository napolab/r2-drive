import { createRunner } from '@r2-drive/core';

import { rawRangeResolver } from './raw-range/index';

import type { PlaybackResolver } from './types';

// 順序に意味がある(specific → broad)。Phase 6 の hlsResolver はこの配列の先頭に入る
// (トランスコード済みオブジェクトのみ ok を返し、それ以外は raw に落ちる)。
export const playbackResolvers = [rawRangeResolver] as const satisfies readonly PlaybackResolver[];

export const resolvePlayback = createRunner(playbackResolvers);
