import { api } from '../src/index';

// vitest-pool-workers が DO を実体化するには、Worker エントリからクラスが
// export されている必要がある。本番の Worker エントリ(apps/web/src/worker.ts)へ
// 載せるのは Task 10。それまではこのテスト用エントリだけが ObjectIndex を公開する。
export { ObjectIndex } from '../src/object-index/index';

export default api;
