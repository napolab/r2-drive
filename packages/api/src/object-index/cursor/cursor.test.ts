import { describe, expect, it } from 'vitest';

import { ForeignCursorError } from '../errors';

import { listCursor, searchCursor } from './index';

// R2 の opaque token を模した文字列。実際の R2 cursor は base64 系のトークンで
// ':' を含まないため、タグと衝突しない。切り替え deploy の瞬間にクライアントが
// 握っている値がこれである(Ruling 18)。
const R2_LIKE_CURSOR = 'eyJrIjoiYS50eHQifQ';

describe('listCursor', () => {
  it('自分が発行した cursor を元の key に戻せる', () => {
    expect(listCursor.decode(listCursor.encode('a/b.txt'))).toBe('a/b.txt');
  });

  it('encode はタグを前置する(R2 の cursor と見分けが付く)', () => {
    expect(listCursor.encode('a/b.txt')).toBe('k1:a/b.txt');
  });

  it('タグの無い文字列は ForeignCursorError で弾く', () => {
    expect(() => listCursor.decode(R2_LIKE_CURSOR)).toThrow(ForeignCursorError);
  });

  it('search の cursor は受け付けない', () => {
    expect(() => listCursor.decode(searchCursor.encode('a/b.txt'))).toThrow(ForeignCursorError);
  });

  // key 自体がタグと同じ文字列で始まっていても壊れないこと。先頭 1 個ぶんだけ剥がす。
  it('タグと同じ文字列で始まる key も往復する', () => {
    expect(listCursor.decode(listCursor.encode('k1:weird.txt'))).toBe('k1:weird.txt');
  });

  // 空文字は R2 の cursor としても索引の cursor としてもありえないが、
  // 「startsWith が空文字に対して true を返す」ような実装事故を塞ぐ。
  it('空文字は弾く', () => {
    expect(() => listCursor.decode('')).toThrow(ForeignCursorError);
  });
});

describe('searchCursor', () => {
  it('自分が発行した cursor を元の key に戻せる', () => {
    expect(searchCursor.decode(searchCursor.encode('a/b.txt'))).toBe('a/b.txt');
  });

  it('encode は list とは違うタグを前置する', () => {
    expect(searchCursor.encode('a/b.txt')).toBe('q1:a/b.txt');
  });

  it('タグの無い文字列は ForeignCursorError で弾く', () => {
    expect(() => searchCursor.decode(R2_LIKE_CURSOR)).toThrow(ForeignCursorError);
  });

  it('list の cursor は受け付けない', () => {
    expect(() => searchCursor.decode(listCursor.encode('a/b.txt'))).toThrow(ForeignCursorError);
  });
});

// 消費エッジ(errors/responder/foreign-cursor)が message をそのまま返すので、
// key やバケット名が漏れないことをここで固定する。
const decodeSecret = () => listCursor.decode('secret-key-looking-cursor');

describe('ForeignCursorError', () => {
  // name は RPC 境界を越えた先の判別子(errors.ts のコメント参照)なので固定する。
  it('name が ForeignCursorError である', () => {
    expect(decodeSecret).toThrow(expect.objectContaining({ name: 'ForeignCursorError' }));
  });

  // toThrow(string) は message の部分一致。含まれていないことを直接張る。
  it('message に cursor の中身を含めない', () => {
    expect(decodeSecret).toThrow(ForeignCursorError);
    expect(decodeSecret).not.toThrow('secret-key-looking-cursor');
  });
});
