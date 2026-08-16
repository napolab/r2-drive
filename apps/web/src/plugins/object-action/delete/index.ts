import { request } from '@r2-drive/api/client';
import { err, ok } from 'neverthrow';

import { getApiClient } from '../../../api/client';

import type { ObjectAction } from '../types';

// getApiClient() の呼び出しは download と同じ理由(SSR に location が無い)で
// run(objects) の中に置く。request() は packages/api/src/client.ts の唯一の
// Response → Result 変換点。ActionDescriptor.run は Promise<void> を返す契約
// なので、ここが Result を消費する唯一の edge になる(.match は 1 箇所だけ)。
// 削除失敗を握り潰さないよう、エラーは reject させて呼び出し側(Task 15 の UI 配線)
// に伝える。
export const deleteAction: ObjectAction = {
  id: 'delete',
  run: (selection) =>
    selection.actionId === 'delete'
      ? ok({
          actionId: 'delete',
          label: '削除',
          destructive: true,
          run: async (objects) => {
            const client = getApiClient();
            for (const object of objects) {
              const result = await request(() => client.buckets[':bucketId'].objects[':path{.+}'].$delete({ param: { bucketId: object.bucketId, path: object.key } }));
              result.match(
                () => undefined,
                (error) => {
                  throw error;
                },
              );
            }
          },
        })
      : err(selection),
};
