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
// **逆向き(索引 → R2)も同じだけ危ない(Ruling 23)。**当初は「R2 側が不正な token
// として自分で弾く」と考えていたが、実測(2026-08-18、miniflare 上)では**弾かない。**
// `list({ cursor: 'q1:pf/1.txt' })` は例外を投げず、`objects: []` / `truncated: false` を
// 返す。listObjects はそれを `next: { kind: 'end' }` に畳むので、**一覧が静かに
// 「ここで終わり」になる。**索引側で塞いだ穴が逆方向に開いたままになるので、
// R2 経路(plugins/object-source/r2-list)も isIndexCursor で弾く。
//
// この経路は `indexed: false` のバケットでも踏める。**検索は indexed に関わらず索引 DO を
// 通るので `q1:` cursor を返す**からである。
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

export const listCursor = codecFor('object index list', LIST_CURSOR_TAG);
export const searchCursor = codecFor('object index search', SEARCH_CURSOR_TAG);

// 索引が発行した cursor かどうか。**R2 経路がこれを使って逆向きを弾く(Ruling 23)。**
//
// 前方一致で判定して誤検出しないのは、R2 の cursor が base64 だからである
// (実測: `cGYvMS50eHQ=` = base64('pf/1.txt'))。base64 の文字集合は
// `A-Za-z0-9+/=` であり **':' を含まない**ので、タグと衝突しない。
// タグの区切りを ':' 以外に変えるときはこの前提も一緒に見直すこと。
const CURSOR_TAGS = [LIST_CURSOR_TAG, SEARCH_CURSOR_TAG] as const;

export const isIndexCursor = (cursor: string): boolean => CURSOR_TAGS.some((tag) => cursor.startsWith(tag));
