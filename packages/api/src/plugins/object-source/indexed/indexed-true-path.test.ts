import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { ObjectIndex } from '../../../object-index/index';

// indexedSource.run 自体は isIndexed / resolveObjectIndex という 2 つの関数の合成でしか
// ないので、この 2 つをモックして「run が索引の DO stub の list を呼び、その結果を
// そのまま ok(ResultAsync) として返す」ことと、渡す引数(特に INDEX_PAGE_SIZE)を検証する。
//
// production の bucketDescriptors に依存しないのが要点である。Task 11 で photos が
// indexed: true になったが、**このテストは registry の内訳が今後どう変わっても落ちない。**
// registry を出典にした担当判定のほうは indexed.test.ts が別途固定している。
vi.mock('../../../object-index/registry', () => ({
  isIndexed: vi.fn(() => true),
  resolveObjectIndex: vi.fn(),
}));

describe('indexedSource(indexed: true 相当)', () => {
  it('担当するバケットでは DO stub の list を呼び、その結果をそのまま返す', async () => {
    const { resolveObjectIndex } = await import('../../../object-index/registry');
    const { indexedSource } = await import('./index');

    const page = { folders: [], objects: [], next: { kind: 'end' as const } };
    const list = vi.fn(async () => page);
    // DurableObjectStub<ObjectIndex> の全 RPC 表面を偽装する必要はない。
    // indexedSource.run が呼ぶのは list だけなので、そこだけ実装したダブルを渡す。
    const stub = { list } as unknown as DurableObjectStub<ObjectIndex>;
    vi.mocked(resolveObjectIndex).mockReturnValue(ok(stub));

    const request = { env: {} as Env, bucketId: 'photos', prefix: '', cursor: undefined };
    const result = indexedSource.run(request);

    expect(result.isOk()).toBe(true);
    const work = result._unsafeUnwrap();
    const outcome = await work;

    expect(outcome._unsafeUnwrap()).toEqual(page);
    expect(list).toHaveBeenCalledWith({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 1000 });
  });
});
