import { err, ok } from 'neverthrow';

import { getApiClient } from '../../../api/client';

import type { ObjectAction } from '../types';

// $url() の呼び出しは run(objects) の中に置く。SSR (workerd) には location が
// 無いため、getApiClient() はモジュール読み込み時ではなく初回アクセス時まで
// 生成を遅延している(apps/web/src/api/client.ts)。ここで外側の run(selection)
// や object literal の直下で $url() を呼ぶと、SSR がこのファイルを import しただけ
// で評価されてしまい落ちる可能性がある。実際に呼ばれるのはユーザーがダウンロードを
// 実行した時(ブラウザのみ)なので、この位置なら安全。
export const downloadAction: ObjectAction = {
  id: 'download',
  run: (selection) =>
    selection.actionId === 'download'
      ? ok({
          actionId: 'download',
          label: 'ダウンロード',
          destructive: false,
          run: async (objects) => {
            const client = getApiClient();
            for (const object of objects) {
              const url = client.buckets[':bucketId'].content[':path{.+}'].$url({ param: { bucketId: object.bucketId, path: object.key } });
              const anchor = document.createElement('a');
              anchor.href = url.toString();
              anchor.download = object.name;
              document.body.appendChild(anchor);
              try {
                anchor.click();
              } finally {
                anchor.remove();
              }
            }
          },
        })
      : err(selection),
};
