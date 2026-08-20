import { ok } from 'neverthrow';

import type { PlaybackResolver } from '../types';

// 常に ok を返す最終防衛線。Range 対応はサーバ(GET /content)が持つので、
// ここは content URL をそのまま返すだけでよい。
export const rawRangeResolver: PlaybackResolver = {
  id: 'raw-range',
  run: (input) => ok({ kind: 'raw', src: input.getContentUrl(input.object) }),
};
