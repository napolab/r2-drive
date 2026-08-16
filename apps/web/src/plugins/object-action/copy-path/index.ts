import { err, ok } from 'neverthrow';

import type { ObjectAction } from '../types';

export const copyPathAction: ObjectAction = {
  id: 'copy-path',
  run: (selection) =>
    selection.actionId === 'copy-path'
      ? ok({
          actionId: 'copy-path',
          label: 'パスをコピー',
          destructive: false,
          run: async (objects) => navigator.clipboard.writeText(objects.map((o) => o.key).join('\n')),
        })
      : err(selection),
};
