import { describe, expect, it } from 'vitest';

import { objectSources } from './registry';

// 順序に意味がある(specific → broad)。挙動テストだけでは
// [r2ListSource, indexedSource] への入れ替えを検知しきれない — r2ListSource は
// 「常に ok を返す最終防衛線」なので、先頭に来ると indexedSource が一度も
// 先勝ちしないまま全部 R2 経路に流れ、**indexed: true のバケットが静かに
// R2 経路に落ちる。**ここで配列の並びそのものを固定する。
describe('objectSources', () => {
  it('indexedSource が r2ListSource より先にある', () => {
    expect(objectSources.map((source) => source.id)).toEqual(['indexed', 'r2-list']);
  });
});
