import { ok } from 'neverthrow';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin, PreviewProps } from '../types';

const OpaquePreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="blank" />
  </span>
);

// 常に ok を返す最終防衛線。未知ファイルの扱いをディスパッチャの if ではなく
// 差し替え可能なプラグインにしておくため。
export const opaquePlugin: FileTypePlugin = {
  id: 'opaque',
  run: () => ok({ typeId: 'opaque', label: 'ファイル', Icon: (props) => <FileIcon {...props} glyph="blank" />, Preview: OpaquePreview }),
};
