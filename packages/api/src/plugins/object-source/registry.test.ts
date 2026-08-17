import { describe, expect, it } from 'vitest';

import { objectSources } from './registry';

// 順序に意味がある(specific → broad)。indexed: false の間は indexedSource が常に
// err を返すため、objects.integration.test.ts のような挙動テストだけでは
// [r2ListSource, indexedSource] に入れ替えても検知できない(indexedSource が
// 一度も先勝ちしないため)。ここで配列の並びそのものを固定する。
describe('objectSources', () => {
  it('indexedSource が r2ListSource より先にある', () => {
    expect(objectSources.map((source) => source.id)).toEqual(['indexed', 'r2-list']);
  });
});
