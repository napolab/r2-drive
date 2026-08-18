import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { indexedSource } from './index';

import type { ListRequest } from '../types';

// プラグインは純粋な run(input) として直接テストする(.claude/rules/tdd.md)。
// 担当するバケットでは run が同期的に resolveObjectIndex を通る(DO stub の解決までは
// 同期)ので、env は本物を渡す。担当しない枝では env は触られない。
const requestFor = (bucketId: string): ListRequest => ({
  env,
  bucketId,
  prefix: '',
  cursor: undefined,
});

// バケット名は production の bucketDescriptors(r2/registry.ts)を出典にする。
// Task 11(2026-08-18)で photos が indexed: true になり、media は対照として
// indexed: false のまま残っている。ここを固定値で書いているのは、
// 「registry を書き換えたらディスパッチも変わる」ことを検出したいからである。
describe('indexedSource', () => {
  it('indexed でないバケットは担当しない', () => {
    const result = indexedSource.run(requestFor('media'));

    expect(result.isErr()).toBe(true);
  });

  it('存在しないバケットも担当しない', () => {
    expect(indexedSource.run(requestFor('nope')).isErr()).toBe(true);
  });

  it('担当しないときは入力をそのまま err に返す(createRunner が次へ渡せる)', () => {
    const input = requestFor('media');

    expect(indexedSource.run(input)._unsafeUnwrapErr()).toBe(input);
  });

  // indexed: true 側のディスパッチ。**担当すると判定した時点で run は
  // resolveObjectIndex(env, id) まで同期的に進む**ので、ここだけは env が実際に触られる
  // (だから requestFor は本物の env を渡している)。DO への list 呼び出し自体は
  // await するまで走らないので、その先は indexed-true-path.test.ts がモックで固定している。
  it('indexed のバケットは担当する', () => {
    expect(indexedSource.run(requestFor('photos')).isOk()).toBe(true);
  });
});
