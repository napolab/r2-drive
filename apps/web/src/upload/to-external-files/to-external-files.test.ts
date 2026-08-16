import { describe, expect, it } from 'vitest';

import { toExternalFiles } from './index';

import type { DirectoryDropItem, FileDropItem, TextDropItem } from 'react-aria-components';

describe('toExternalFiles', () => {
  it('OS の FileDropItem だけを File に変換して directory/text を無視する', async () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const fileItem: FileDropItem = {
      kind: 'file',
      type: 'image/jpeg',
      name: 'photo.jpg',
      getFile: async () => file,
      getText: async () => 'photo',
    };
    const directoryItem: DirectoryDropItem = {
      kind: 'directory',
      name: 'folder',
      getEntries: async function* () {
        yield fileItem;
      },
    };
    const textItem: TextDropItem = {
      kind: 'text',
      types: new Set(['text/plain']),
      getText: async () => 'not a file',
    };

    await expect(toExternalFiles([directoryItem, textItem, fileItem])).resolves.toEqual([file]);
  });
});
