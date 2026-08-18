import { ForeignCursorError } from '../errors';

// Ruling 18(切り替え deploy の前提条件)
//
// 索引が返す cursor の実体は「最後に返した key」だが、R2 経路が返す opaque token とは
// 見た目で区別が付かない。`indexed: false → true` の deploy が起きた瞬間、スクロール中の
// クライアントが握っている **R2 の cursor が索引経路に渡る。**索引側はそれを
// `WHERE key > '<その文字列>'` として素直に解釈するので、**エラーにならず静かに違う
// ページを返す。**利用者から見れば「ファイルが消えた」であり、一覧で沈黙して間違うのは
// 最悪の失敗モードなので、経路タグを付けて検出可能にする。
//
// 逆向き(索引 → R2)は R2 側が不正な token として自分で弾くので、ここでは扱わない。
//
// **タグは list と search で分ける。**同じにすると「検索の cursor を一覧に渡す」を
// 弾けない。検索は prefix を持たないので、一覧側で受け取ると別フォルダのキーを
// 起点に走査してしまい、これも静かに間違う。
//
// 区切りに ':' を使うのは R2 の cursor と衝突させないため(R2 の cursor は base64 系の
// トークンで ':' を含まない)。数字は形式のバージョンで、cursor の意味を変えるときに
// 上げれば、古い cursor が自動的に foreign として弾かれる。
const LIST_CURSOR_TAG = 'k1:';
const SEARCH_CURSOR_TAG = 'q1:';

// NextPage.cursor はクライアントから見て opaque な string なので、タグ付けは
// ワイヤ互換である(ObjectDescriptor / NextPage / ObjectPage の型は変わらない)。
export type CursorCodec = {
  readonly encode: (key: string) => string;
  readonly decode: (cursor: string) => string;
};

// 剥がすのは先頭 1 個ぶんだけ。key 自体がタグと同じ文字列で始まっていても往復する。
const codecFor = (route: string, tag: string): CursorCodec => ({
  encode: (key) => `${tag}${key}`,
  decode: (cursor) => {
    if (!cursor.startsWith(tag)) throw new ForeignCursorError(route);

    return cursor.slice(tag.length);
  },
});

export const listCursor = codecFor('list', LIST_CURSOR_TAG);
export const searchCursor = codecFor('search', SEARCH_CURSOR_TAG);
