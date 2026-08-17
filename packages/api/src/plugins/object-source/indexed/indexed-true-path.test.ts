import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { ObjectIndex } from '../../../object-index/index';

// indexed: true の分岐は bucketDescriptors(deploy 時の設定)が全て false に固定されて
// いるため、production の bucketDescriptors を書き換えずに再現するには
// object-index/registry を差し替えるしかない。indexedSource.run 自体は
// isIndexed / resolveObjectIndex という 2 つの関数の合成でしかないので、
// この 2 つをモックして「indexed: true 相当の状況で run が索引の DO stub を
// 呼び、その結果をそのまま ok(ResultAsync) として返す」ことを検証する。
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
