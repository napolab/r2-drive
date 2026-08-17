import { describe, expect, it } from 'vitest';

import { indexedSource } from './index';

import type { ListRequest } from '../types';

// プラグインは純粋な run(input) として直接テストする(.claude/rules/tdd.md)。
// env は run の中で触られないので、ディスパッチ判定だけをここで固定する。
const requestFor = (bucketId: string): ListRequest => ({
  env: {} as Env,
  bucketId,
  prefix: '',
  cursor: undefined,
});

describe('indexedSource', () => {
  it('indexed でないバケットは担当しない', () => {
    const result = indexedSource.run(requestFor('photos'));

    expect(result.isErr()).toBe(true);
  });

  it('存在しないバケットも担当しない', () => {
    expect(indexedSource.run(requestFor('nope')).isErr()).toBe(true);
  });

  it('担当しないときは入力をそのまま err に返す(createRunner が次へ渡せる)', () => {
    const input = requestFor('photos');

    expect(indexedSource.run(input)._unsafeUnwrapErr()).toBe(input);
  });
});
