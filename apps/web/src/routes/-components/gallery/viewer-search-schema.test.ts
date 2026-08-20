import { describe, expect, it } from 'vitest';

import { viewerSearchSchema } from '../../b.$bucketId.$';

// 受け入れ基準(最終レビュー Finding 3): 手打ちの `?mode=gallery` のような未知の
// enum 値は、ルート全体をエラー画面に落とすのではなく無指定(= mode: undefined、
// 実質 gallery)へ degrade する。validateSearch は `.parse()` を呼ぶだけなので、
// この degrade は schema 自身(`.catch(undefined)`)が担保しなければならない。
// router を経由せず schema を直接 import して検証する(このテストは routes/ 直下ではなく
// -components/ 配下に置く — TanStack Router のファイルベースルーティングに
// `.test.ts` を拾わせないため)。
describe('viewerSearchSchema', () => {
  it('mode が既知の値("tiles")のときはそのまま通す', () => {
    expect(viewerSearchSchema.parse({ mode: 'tiles' })).toEqual({ mode: 'tiles' });
  });

  it('mode が未指定のときは undefined のまま通す', () => {
    expect(viewerSearchSchema.parse({})).toEqual({ mode: undefined });
  });

  it('mode が未知の値のときは throw せず undefined に degrade する', () => {
    expect(viewerSearchSchema.parse({ mode: 'gallery' })).toEqual({ mode: undefined });
  });

  it('view はそのまま通す(mode の degrade と独立)', () => {
    expect(viewerSearchSchema.parse({ view: 'a.png', mode: 'unknown' })).toEqual({ view: 'a.png', mode: undefined });
  });
});
