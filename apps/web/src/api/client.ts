import { createApiClient } from '@r2-drive/api/client';

import type { ApiClient } from '@r2-drive/api/client';

// 同一オリジン。Access の Cookie が自動で乗る。
// Worker は '/api' にマウントしているので、hc の baseUrl にも '/api' を足す必要がある
// (足さないと AppType のパス空間 '/buckets' '/uploads' へ直接飛んで 404 になる)。
// `hc` の $url() は相対 URL を渡すと throw するため、baseUrl は絶対 URL にする。
//
// TanStack Start はコンポーネントツリーを SSR (workerd) でも評価するため、
// モジュール読み込み時に `location` へ触れると SSR で落ちる。生成は初回アクセス時まで遅延する。
let cached: ApiClient | undefined;

export const getApiClient = (): ApiClient => {
  if (cached === undefined) {
    cached = createApiClient({ kind: 'browser', origin: new URL('/api', location.origin).toString() });
  }

  return cached;
};
