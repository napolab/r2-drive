import { isFileDropItem } from 'react-aria-components';

import type { DropItem } from 'react-aria-components';

export const toExternalFiles = (items: readonly DropItem[]): Promise<File[]> => Promise.all(items.filter(isFileDropItem).map((item) => item.getFile()));
