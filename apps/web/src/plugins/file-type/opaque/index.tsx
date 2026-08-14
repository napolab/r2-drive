import { ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

// 常に ok を返す最終防衛線。未知ファイルの扱いをディスパッチャの if ではなく
// 差し替え可能なプラグインにしておくため。
export const opaquePlugin: FileTypePlugin = {
  id: 'opaque',
  run: () => ok({ typeId: 'opaque', label: 'ファイル', Icon: (props) => <FileIcon {...props} glyph="blank" /> }),
};
