import { createRunner } from '@r2-drive/core';

import { audioPlugin } from './audio/index';
import { imagePlugin } from './image/index';
import { markdownPlugin } from './markdown/index';
import { opaquePlugin } from './opaque/index';
import { textPlugin } from './text/index';
import { videoPlugin } from './video/index';

import type { FileTypePlugin } from './types';

// 順序に意味がある(specific → broad)。opaque は必ず最後。
// text は「text/* または既知のコード系拡張子」と広めに取るので、markdown より後に置く。
export const fileTypePlugins = [markdownPlugin, imagePlugin, videoPlugin, audioPlugin, textPlugin, opaquePlugin] as const satisfies readonly FileTypePlugin[];

export const resolveFileType = createRunner(fileTypePlugins);
