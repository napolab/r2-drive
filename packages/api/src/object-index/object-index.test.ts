import { NO_MEDIA } from '@r2-drive/core';
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { objectIndexNamespace } from '../../test/object-index-namespace';
import { waitForBackfill } from '../../test/wait-for-backfill';

import { BACKFILL_PAGES_KEY, BUCKET_ID_KEY } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const descriptorOf = (key: string, overrides: Partial<ObjectDescriptor> = {}): ObjectDescriptor => ({
  bucketId: 'photos',
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  contentType: 'application/octet-stream',
  size: 10,
  uploadedAt: '2026-08-17T00:00:00.000Z',
  etag: `"etag-${key}"`,
  media: NO_MEDIA,
  ...overrides,
});

// テストごとに別 DO を使う。vitest-pool-workers のストレージ分離はファイル単位なので、
// 同一ファイル内のテスト間で書き込みは巻き戻らない。
const stubFor = (name: string) => objectIndexNamespace.get(objectIndexNamespace.idFromName(name));

describe('ObjectIndex の書き込み', () => {
  it('upsert したオブジェクトが数えられる', async () => {
    const stub = stubFor('write-count');
    await stub.upsert(descriptorOf('a.txt'));
    await stub.upsert(descriptorOf('photos/b.jpg'));

    await expect(stub.count()).resolves.toBe(2);
  });

  it('同じ key の upsert は行を増やさず内容を置き換える', async () => {
    const stub = stubFor('write-upsert');
    await stub.upsert(descriptorOf('a.txt', { size: 10, etag: '"old"' }));
    await stub.upsert(descriptorOf('a.txt', { size: 999, etag: '"new"' }));

    await expect(stub.count()).resolves.toBe(1);
    await expect(stub.debugRow('a.txt')).resolves.toEqual({
      key: 'a.txt',
      name: 'a.txt',
      parentPrefix: '',
      contentType: 'application/octet-stream',
      size: 999,
      uploadedAt: '2026-08-17T00:00:00.000Z',
      etag: '"new"',
      width: null,
      height: null,
    });
  });

  // Task 5 の一覧はこの parent_prefix でフォルダを引く。列の中身を見ないと
  // 「parentPrefix を定数に固定する」変異がテストをすり抜ける。
  it('objects の name / parent_prefix は key から導かれる', async () => {
    const stub = stubFor('write-row-columns');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugRow('a/b/c.txt')).resolves.toMatchObject({ name: 'c.txt', parentPrefix: 'a/b/' });
  });

  // 渡した name は保存されない(key から再計算する)。矛盾した name を渡しても
  // 索引は key に従うことを固定する。
  it('descriptor の name が key と矛盾していても key 由来の name が入る', async () => {
    const stub = stubFor('write-row-name-ignored');
    await stub.upsert(descriptorOf('a/b/c.txt', { name: 'ウソの名前.txt' }));

    await expect(stub.debugRow('a/b/c.txt')).resolves.toMatchObject({ name: 'c.txt' });
  });

  it('remove で行が消える', async () => {
    const stub = stubFor('write-remove');
    await stub.upsert(descriptorOf('a.txt'));
    await stub.remove('a.txt');

    await expect(stub.count()).resolves.toBe(0);
  });

  it('存在しない key の remove は例外にならない', async () => {
    const stub = stubFor('write-remove-missing');

    await expect(stub.remove('nope.txt')).resolves.toBeUndefined();
  });
});

describe('ObjectIndex の prefixes', () => {
  it('upsert が祖先 prefix を prefixes 表に入れる', async () => {
    const stub = stubFor('write-prefixes');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([
      { prefix: 'a/', parentPrefix: '' },
      { prefix: 'a/b/', parentPrefix: 'a/' },
    ]);
  });

  // 深い階層。prefixes の parent_prefix が「1 つ上の prefix」に連鎖することを見る。
  it('3 階層の祖先 prefix が親を辿れる形で入る', async () => {
    const stub = stubFor('write-prefixes-deep');
    await stub.upsert(descriptorOf('a/b/c/d.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([
      { prefix: 'a/', parentPrefix: '' },
      { prefix: 'a/b/', parentPrefix: 'a/' },
      { prefix: 'a/b/c/', parentPrefix: 'a/b/' },
    ]);
  });

  it('祖先 prefix は重複しても 1 行のまま', async () => {
    const stub = stubFor('write-prefixes-dedup');
    await stub.upsert(descriptorOf('a/b/c.txt'));
    await stub.upsert(descriptorOf('a/b/d.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([
      { prefix: 'a/', parentPrefix: '' },
      { prefix: 'a/b/', parentPrefix: 'a/' },
    ]);
  });

  it('ルート直下のオブジェクトは prefixes に何も入れない', async () => {
    const stub = stubFor('write-prefixes-root');
    await stub.upsert(descriptorOf('a.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual([]);
  });
});

// spec §8 が「本命の防波堤」と呼ぶ整合性。objects と objects_fts が同じ書き込みで
// 動くこと(FTS だけ書き忘れない)を positive 側から張る。
// ロールバックの証明には失敗注入が要るので、そちらは別タスクに送っている。
describe('ObjectIndex と objects_fts の整合性', () => {
  it('upsert した key は FTS からも引ける', async () => {
    const stub = stubFor('fts-upsert');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugFtsKeys()).resolves.toEqual(['a/b/c.txt']);
  });

  it('FTS は name で MATCH できる', async () => {
    const stub = stubFor('fts-match');
    await stub.upsert(descriptorOf('photos/vacation-2026.jpg'));
    await stub.upsert(descriptorOf('docs/invoice-2026.pdf'));

    await expect(stub.debugFtsSearch('vacation')).resolves.toEqual(['photos/vacation-2026.jpg']);
  });

  it('同じ key を 2 回 upsert しても FTS の行は増えない', async () => {
    const stub = stubFor('fts-upsert-twice');
    await stub.upsert(descriptorOf('a.txt', { size: 1 }));
    await stub.upsert(descriptorOf('a.txt', { size: 2 }));

    await expect(stub.debugFtsKeys()).resolves.toEqual(['a.txt']);
  });

  it('remove した key は FTS からも消える', async () => {
    const stub = stubFor('fts-remove');
    await stub.upsert(descriptorOf('a.txt'));
    await stub.upsert(descriptorOf('b.txt'));
    await stub.remove('a.txt');

    await expect(stub.debugFtsKeys()).resolves.toEqual(['b.txt']);
  });
});

// 1 バケット = 1 DO は idFromName(bucketId) を呼ぶ側の不変条件でしかない。
// 誤ルーティングを静かに成功させない(Ruling 11)。
describe('ObjectIndex のバケット guard', () => {
  it('同じ bucketId の upsert は続けられる', async () => {
    const stub = stubFor('bucket-guard-same');
    await stub.upsert(descriptorOf('a.txt', { bucketId: 'photos' }));
    await stub.upsert(descriptorOf('b.txt', { bucketId: 'photos' }));

    await expect(stub.count()).resolves.toBe(2);
  });

  it('別の bucketId の upsert は例外になる', async () => {
    const stub = stubFor('bucket-guard-mismatch');
    await stub.upsert(descriptorOf('a.txt', { bucketId: 'photos' }));

    await expect(async () => stub.upsert(descriptorOf('b.txt', { bucketId: 'media' }))).rejects.toThrow(/bound to bucket "photos" but received "media"/);
  });

  it('拒否された upsert は 1 行も書かない', async () => {
    const stub = stubFor('bucket-guard-no-write');
    await stub.upsert(descriptorOf('a.txt', { bucketId: 'photos' }));
    await expect(async () => stub.upsert(descriptorOf('x/y.txt', { bucketId: 'media' }))).rejects.toThrow();

    await expect(stub.count()).resolves.toBe(1);
    await expect(stub.debugPrefixes()).resolves.toEqual([]);
    await expect(stub.debugFtsKeys()).resolves.toEqual(['a.txt']);
  });
});

describe('ObjectIndex の一覧', () => {
  it('指定した prefix 直下のオブジェクトだけを key 順で返す', async () => {
    const stub = stubFor('list-basic');
    await stub.upsert(descriptorOf('a/2.txt'));
    await stub.upsert(descriptorOf('a/1.txt'));
    await stub.upsert(descriptorOf('a/b/deep.txt'));
    await stub.upsert(descriptorOf('root.txt'));

    const page = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.objects.map((o) => o.key)).toEqual(['a/1.txt', 'a/2.txt']);
    expect(page.next).toEqual({ kind: 'end' });
  });

  it('直下のフォルダを folders に返す', async () => {
    const stub = stubFor('list-folders');
    await stub.upsert(descriptorOf('a/b/deep.txt'));
    await stub.upsert(descriptorOf('a/c/deep.txt'));
    await stub.upsert(descriptorOf('a/x.txt'));

    const page = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.folders.map((f) => f.prefix)).toEqual(['a/b/', 'a/c/']);
    expect(page.folders.map((f) => f.name)).toEqual(['b', 'c']);
  });

  it('limit を超えると next が more になり cursor で続きが取れる', async () => {
    const stub = stubFor('list-cursor');
    await stub.upsert(descriptorOf('a/1.txt'));
    await stub.upsert(descriptorOf('a/2.txt'));
    await stub.upsert(descriptorOf('a/3.txt'));

    const first = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 2 });
    expect(first.objects.map((o) => o.key)).toEqual(['a/1.txt', 'a/2.txt']);
    if (first.next.kind !== 'more') throw new Error('next が more にならなかった');

    const second = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: first.next.cursor, limit: 2 });
    expect(second.objects.map((o) => o.key)).toEqual(['a/3.txt']);
    expect(second.next).toEqual({ kind: 'end' });
  });

  it('2 ページ目以降は folders を返さない(1 ページ目で出し切る)', async () => {
    const stub = stubFor('list-folders-once');
    await stub.upsert(descriptorOf('a/b/deep.txt'));
    await stub.upsert(descriptorOf('a/1.txt'));
    await stub.upsert(descriptorOf('a/2.txt'));

    const first = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 1 });
    expect(first.folders).toHaveLength(1);
    if (first.next.kind !== 'more') throw new Error('next が more にならなかった');

    const second = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: first.next.cursor, limit: 1 });
    expect(second.folders).toEqual([]);
    // 2 ページ目はちょうど limit(1) 件しか残っていない(a/2.txt のみ)。ここで
    // rows.length(limit + 1 件フェッチした実際の件数)が limit を超えないケースを
    // 踏む。`rows.length > input.limit` を `>=` に変異させても、他のテストは
    // 「明確に超える/明確に下回る」件数しか使っていないため落ちない。
    // ここでちょうど limit 件のケースを固定して穴をふさぐ。
    expect(second.next).toEqual({ kind: 'end' });
  });

  // I1: 「limit + 1 件フェッチしたが実際は limit 件しかなかった」経路を単独で固定する。
  // `rows.length > input.limit` を `>=` に変異させると、この 3 件 ちょうど limit=3 の
  // ケースで next が誤って more になり、この行が落ちる。
  it('ちょうど limit 件ある prefix で next が end になる', async () => {
    const stub = stubFor('list-exact-limit');
    await stub.upsert(descriptorOf('a/1.txt'));
    await stub.upsert(descriptorOf('a/2.txt'));
    await stub.upsert(descriptorOf('a/3.txt'));

    const page = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 3 });

    expect(page.objects.map((o) => o.key)).toEqual(['a/1.txt', 'a/2.txt', 'a/3.txt']);
    expect(page.next).toEqual({ kind: 'end' });
  });

  // Minor: 0 件ページ。何も upsert していない prefix を引いても objects / folders は
  // 空配列で、next は end であることを固定する。
  it('何もない prefix を引くと空ページが返る', async () => {
    const stub = stubFor('list-empty');

    const page = await stub.list({ bucketId: 'photos', prefix: 'nothing/', cursor: undefined, limit: 10 });

    expect(page.objects).toEqual([]);
    expect(page.folders).toEqual([]);
    expect(page.next).toEqual({ kind: 'end' });
  });

  it('返す ObjectDescriptor は渡した bucketId を持つ', async () => {
    const stub = stubFor('list-bucket-id');
    await stub.upsert(descriptorOf('a/1.txt'));

    const page = await stub.list({ bucketId: 'media', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.objects[0]?.bucketId).toBe('media');
  });

  // Ruling 2: remove は prefixes 行を消さない設計なので、中身が全部消えたフォルダが
  // 幽霊フォルダとして一覧に残ってはいけない。R2 経路(delimitedPrefixes)には
  // この現象が存在しないので、indexed の有無で挙動が変わらないことを固定する。
  it('配下の唯一のオブジェクトを remove すると幽霊フォルダが folders に出ない', async () => {
    const stub = stubFor('list-ghost-folder');
    await stub.upsert(descriptorOf('a/b/c.txt'));
    await stub.remove('a/b/c.txt');

    const page = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.folders.map((f) => f.prefix)).not.toContain('a/b/');
  });

  // 上のテストの positive control。EXISTS を外す変異で「常に folders が出る」実装にすり替わっても、
  // このテスト単体は通ってしまう。ghost-folder テストと対にして初めて EXISTS の有無を検出できる。
  it('配下にオブジェクトが残っていれば folders に出る', async () => {
    const stub = stubFor('list-folder-with-object');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    const page = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.folders.map((f) => f.prefix)).toContain('a/b/');
  });

  // Ruling 14: R2 には末尾 '/' の 0 バイトオブジェクト(フォルダマーカー)が実在し、
  // 多くのツールが作る。packages/api/src/r2/list.ts の listObjects は
  // `.filter((object) => object.key !== input.prefix)` で prefix そのものを表す
  // マーカーを除外している(同ファイルのコメント参照)。索引側もこの挙動に揃える。
  // 揃えないと indexed の有無で一覧の中身が変わり、名前が空のエントリが出る。
  it('prefix 自身を表すマーカーは objects に出ない', async () => {
    const stub = stubFor('list-marker-excluded');
    await stub.upsert(descriptorOf('a/marker.txt'));
    await stub.upsert(descriptorOf('a/'));

    const page = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.objects.map((o) => o.key)).toEqual(['a/marker.txt']);
  });

  // 同じ Ruling 14 を #foldersOf の EXISTS 側でも固定する。除かないと「自分の
  // マーカーだけを含むフォルダ」が非空と誤判定され、開くと空になる
  // (Ruling 2 で潰した幽霊フォルダと同種の乖離)。
  it('マーカーだけのフォルダは folders に出ない', async () => {
    const stub = stubFor('list-marker-only-folder');
    await stub.upsert(descriptorOf('a/b/'));

    const page = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.folders.map((f) => f.prefix)).not.toContain('a/b/');
  });
});

describe('ObjectIndex の検索', () => {
  it('ファイル名の部分一致で引ける', async () => {
    const stub = stubFor('search-basic');
    await stub.upsert(descriptorOf('a/vacation-2026.jpg'));
    await stub.upsert(descriptorOf('a/invoice-2026.pdf'));

    const page = await stub.search({ bucketId: 'photos', query: 'vacation', cursor: undefined, limit: 10 });

    expect(page.objects.map((o) => o.key)).toEqual(['a/vacation-2026.jpg']);
    expect(page.folders).toEqual([]);
  });

  it('remove した行は検索結果から消える', async () => {
    const stub = stubFor('search-after-remove');
    await stub.upsert(descriptorOf('a/vacation.jpg'));
    await stub.remove('a/vacation.jpg');

    const page = await stub.search({ bucketId: 'photos', query: 'vacation', cursor: undefined, limit: 10 });

    expect(page.objects).toEqual([]);
  });

  it('upsert で名前が変わると新しい名前で引けて古い名前では引けない', async () => {
    const stub = stubFor('search-after-rename');
    await stub.upsert(descriptorOf('a/oldname.txt'));
    await stub.upsert(descriptorOf('a/oldname.txt', { name: 'ignored' }));
    await stub.remove('a/oldname.txt');
    await stub.upsert(descriptorOf('a/newname.txt'));

    await expect(stub.search({ bucketId: 'photos', query: 'oldname', cursor: undefined, limit: 10 })).resolves.toMatchObject({ objects: [] });
    const found = await stub.search({ bucketId: 'photos', query: 'newname', cursor: undefined, limit: 10 });
    expect(found.objects.map((o) => o.key)).toEqual(['a/newname.txt']);
  });

  it('該当が無ければ空で end を返す', async () => {
    const stub = stubFor('search-empty');
    await stub.upsert(descriptorOf('a/1.txt'));

    const page = await stub.search({ bucketId: 'photos', query: 'zzzz', cursor: undefined, limit: 10 });

    expect(page.objects).toEqual([]);
    expect(page.next).toEqual({ kind: 'end' });
  });

  // 順序は rank(一致度)ではなく key 昇順で決定的に返ることを固定する。insert 順を
  // わざと key の昇順と食い違わせている。rank 順(ORDER BY rank)に変異すると、
  // 一致度が同点の行は内部的に rowid(≒ insert 順)で並ぶため 'c', 'a', 'b' の順で
  // 返ってしまい、この行が落ちる。
  it('検索結果は insert 順ではなく key 昇順で返る', async () => {
    const stub = stubFor('search-order-by-key');
    await stub.upsert(descriptorOf('a/report-c.txt'));
    await stub.upsert(descriptorOf('a/report-a.txt'));
    await stub.upsert(descriptorOf('a/report-b.txt'));

    const page = await stub.search({ bucketId: 'photos', query: 'report', cursor: undefined, limit: 10 });

    expect(page.objects.map((o) => o.key)).toEqual(['a/report-a.txt', 'a/report-b.txt', 'a/report-c.txt']);
  });

  it('limit を超えると cursor で続きが取れる', async () => {
    const stub = stubFor('search-cursor');
    await stub.upsert(descriptorOf('a/report-1.txt'));
    await stub.upsert(descriptorOf('a/report-2.txt'));
    await stub.upsert(descriptorOf('a/report-3.txt'));

    const first = await stub.search({ bucketId: 'photos', query: 'report', cursor: undefined, limit: 2 });
    expect(first.objects).toHaveLength(2);
    if (first.next.kind !== 'more') throw new Error('next が more にならなかった');

    const second = await stub.search({ bucketId: 'photos', query: 'report', cursor: first.next.cursor, limit: 2 });
    expect(second.objects).toHaveLength(1);
  });

  // I1 と同じ穴を search 側でも塞ぐ(Task 5 で見つかった off-by-one)。
  // 「limit + 1 件フェッチしたが実際は limit 件しかなかった」経路を単独で固定する。
  // `rows.length > input.limit` を `>=` に変異させると、この 2 件 ちょうど
  // limit=2 のケースで next が誤って more になり、この行が落ちる。
  it('ちょうど limit 件ヒットすると next が end になる', async () => {
    const stub = stubFor('search-exact-limit');
    await stub.upsert(descriptorOf('a/report-1.txt'));
    await stub.upsert(descriptorOf('a/report-2.txt'));

    const page = await stub.search({ bucketId: 'photos', query: 'report', cursor: undefined, limit: 2 });

    expect(page.objects.map((o) => o.key)).toEqual(['a/report-1.txt', 'a/report-2.txt']);
    expect(page.next).toEqual({ kind: 'end' });
  });

  it('FTS5 の演算子を含む入力で例外を投げない', async () => {
    const stub = stubFor('search-hostile');
    await stub.upsert(descriptorOf('a/1.txt'));

    await expect(stub.search({ bucketId: 'photos', query: 'a OR "b', cursor: undefined, limit: 10 })).resolves.toMatchObject({ folders: [] });
  });

  // Ruling 15: search も list と同じく、prefix そのものを表す 0 バイトのフォルダ
  // マーカー(末尾 '/' のキー)を除外する。マーカーは name が空文字だが、key に
  // 含まれる文字列で FTS がマッチしうる(例: key 'docs/' は 'docs' で前方一致する)。
  // 除外しないと「検索では見えるが一覧では開けない」非対称が生まれる。
  // 判定はマーカーの定義そのもの(key が末尾 '/' で終わる)に置く。name が空文字の
  // 行を除外する実装だと、name が空になる別の条件が将来増えたときに崩れる。
  it('末尾が / のフォルダマーカーは検索結果に出ない', async () => {
    const stub = stubFor('search-marker-excluded');
    await stub.upsert(descriptorOf('docs/'));
    await stub.upsert(descriptorOf('docs/design.md'));

    const page = await stub.search({ bucketId: 'photos', query: 'docs', cursor: undefined, limit: 10 });

    expect(page.objects.map((o) => o.key)).toEqual(['docs/design.md']);
  });
});

// Ruling 18: `indexed: false → true` の切り替え deploy を跨いだクライアントは、
// R2 の opaque cursor を握ったまま索引経路へ次のページを要求する。タグが無いと
// 索引側は `WHERE key > '<その token>'` として素直に解釈し、**エラーにならず静かに
// 違うページを返す**(利用者から見れば「ファイルが消えた」)。
//
// 一覧で沈黙して間違うのが最悪の失敗モードなので、経路タグの往復と、タグの無い /
// 違う cursor を拒否することをここで固定する。
describe('ObjectIndex の cursor の経路タグ(Ruling 18)', () => {
  // 実際の R2 cursor は base64 系のトークン。タグの区切り ':' を含まない。
  const R2_LIKE_CURSOR = 'eyJrIjoiYS8xLnR4dCJ9';

  const seed = async (name: string) => {
    const stub = stubFor(name);
    await stub.upsert(descriptorOf('a/1.txt'));
    await stub.upsert(descriptorOf('a/2.txt'));

    return stub;
  };

  it('list が返す cursor はタグ付きで、そのまま list に返せる', async () => {
    const stub = await seed('cursor-tag-list-roundtrip');

    const first = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 1 });
    if (first.next.kind !== 'more') throw new Error('next が more にならなかった');
    expect(first.next.cursor).toBe('k1:a/1.txt');

    const second = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: first.next.cursor, limit: 1 });
    expect(second.objects.map((o) => o.key)).toEqual(['a/2.txt']);
  });

  it('search が返す cursor はタグ付きで、そのまま search に返せる', async () => {
    const stub = await seed('cursor-tag-search-roundtrip');

    // key 'a/1.txt' / 'a/2.txt' はどちらも 'a' トークンを持つので 2 件ヒットする。
    const first = await stub.search({ bucketId: 'photos', query: 'a', cursor: undefined, limit: 1 });
    if (first.next.kind !== 'more') throw new Error('next が more にならなかった');
    expect(first.next.cursor).toBe('q1:a/1.txt');

    const second = await stub.search({ bucketId: 'photos', query: 'a', cursor: first.next.cursor, limit: 1 });
    expect(second.objects.map((o) => o.key)).toEqual(['a/2.txt']);
  });

  it('list は R2 の opaque cursor を静かに受け付けず ForeignCursorError にする', async () => {
    const stub = await seed('cursor-tag-list-foreign');

    await expect(async () => stub.list({ bucketId: 'photos', prefix: 'a/', cursor: R2_LIKE_CURSOR, limit: 10 })).rejects.toMatchObject({ name: 'ForeignCursorError' });
  });

  it('search も R2 の opaque cursor を ForeignCursorError にする', async () => {
    const stub = await seed('cursor-tag-search-foreign');

    await expect(async () => stub.search({ bucketId: 'photos', query: 'a', cursor: R2_LIKE_CURSOR, limit: 10 })).rejects.toMatchObject({ name: 'ForeignCursorError' });
  });

  it('list の cursor を search に渡すと弾く(タグを分けている意味)', async () => {
    const stub = await seed('cursor-tag-cross-list-to-search');

    const first = await stub.list({ bucketId: 'photos', prefix: 'a/', cursor: undefined, limit: 1 });
    if (first.next.kind !== 'more') throw new Error('next が more にならなかった');
    const { cursor } = first.next;

    await expect(async () => stub.search({ bucketId: 'photos', query: 'a', cursor, limit: 10 })).rejects.toMatchObject({ name: 'ForeignCursorError' });
  });

  it('search の cursor を list に渡すと弾く', async () => {
    const stub = await seed('cursor-tag-cross-search-to-list');

    const first = await stub.search({ bucketId: 'photos', query: 'a', cursor: undefined, limit: 1 });
    if (first.next.kind !== 'more') throw new Error('next が more にならなかった');
    const { cursor } = first.next;

    await expect(async () => stub.list({ bucketId: 'photos', prefix: 'a/', cursor, limit: 10 })).rejects.toMatchObject({ name: 'ForeignCursorError' });
  });
});

// R2 が真実であり、索引は後付けの読み取り加速層である。バックフィルはその 2 つを
// 突き合わせて索引を R2 の現在状態に寄せる唯一の手段であり、
// packages/api/src/uploads/index.ts の multipart complete が「索引書き込みに失敗しても
// R2 は巻き戻さない」と決めたときに約束した回復手段そのものである。
//
// したがって固定すべき契約は 3 つある:
//   1. 何度実行しても行が増えない
//   2. 途中で止めて再実行すると続きから進み、最終的に全件揃う
//      → ページ境界(1000 件)を踏む必要があるので test/backfill-pagination.integration.test.ts
//   3. 「R2 にあるが索引に無い」オブジェクトを拾える
//
// このファイルの R2(BUCKET_PHOTOS)は以下のテストが共有する(vitest-pool-workers の
// ストレージ分離はファイル単位)。バックフィルはバケット全体を舐めるので、件数の
// 絶対値に依存する検証は書かず、特定の行の有無か「R2 の実件数と一致すること」で見る。
describe('ObjectIndex のバックフィル', () => {
  // アップロード API を経由しないので索引には入らない。「R2 にあるが索引に無い」状態の作り方。
  const putDirectly = async (key: string, contentType: string): Promise<void> => {
    await env.BUCKET_PHOTOS.put(key, 'x', { httpMetadata: { contentType } });
  };

  it('一度も走っていなければ idle', async () => {
    await expect(stubFor('backfill-idle').status()).resolves.toEqual({ kind: 'idle' });
  });

  it('R2 の中身を全部取り込んで complete になる', async () => {
    for (const key of ['bf/1.txt', 'bf/2.txt', 'bf/a/3.txt']) await putDirectly(key, 'text/plain');
    const stub = stubFor('backfill-run');

    await stub.startBackfill('photos');
    await waitForBackfill(stub);

    const listed = await env.BUCKET_PHOTOS.list({ limit: 1000 });
    expect(listed.truncated).toBe(false);
    await expect(stub.status()).resolves.toEqual({ kind: 'complete', indexed: listed.objects.length });
    await expect(stub.debugRow('bf/a/3.txt')).resolves.toMatchObject({ name: '3.txt', parentPrefix: 'bf/a/' });
  });

  // 契約 3。uploads/index.ts の multipart complete が「uploadId を消費済みで
  // リトライが効かない」と言っている失敗モードの回復そのもの。
  it('R2 にあるが索引に無いオブジェクトを拾う', async () => {
    const stub = stubFor('backfill-orphan');
    await stub.upsert(descriptorOf('bf-orphan/known.txt'));
    await putDirectly('bf-orphan/lost.txt', 'text/plain');
    await expect(stub.debugRow('bf-orphan/lost.txt')).resolves.toBeUndefined();

    await stub.startBackfill('photos');
    await waitForBackfill(stub);

    await expect(stub.debugRow('bf-orphan/lost.txt')).resolves.toMatchObject({ name: 'lost.txt', parentPrefix: 'bf-orphan/' });
  });

  // 契約 1。upsert の冪等性にそのまま乗る。
  it('2 回実行しても行が増えない', async () => {
    await putDirectly('bf-idem/1.txt', 'text/plain');
    const stub = stubFor('backfill-idempotent');

    await stub.startBackfill('photos');
    await waitForBackfill(stub);
    const first = await stub.count();

    await stub.startBackfill('photos');
    await waitForBackfill(stub);

    await expect(stub.count()).resolves.toBe(first);
    await expect(stub.status()).resolves.toEqual({ kind: 'complete', indexed: first });
  });

  // startBackfill は meta に backfill_* を書くが、bucket_id(Ruling 11 の誤ルーティング
  // 検出)を巻き添えにしてはいけない。meta を一括クリアする実装だと guard が静かに
  // 無効化され、別バケット向けの upsert が通ってしまう。
  //
  // **空のバケットで検証すること。**中身のあるバケットで試すと、バックフィル自身の
  // upsert が bucket_id を焼き直すため、meta を一括クリアする実装でも guard が復活して
  // しまい変異を検出できない(実測で確認済み)。BUCKET_MEDIA はこのファイルの他の
  // テストが一切触らないので空である。その前提自体もここで張る。
  it('バックフィルは meta.bucket_id を壊さない', async () => {
    const media = await env.BUCKET_MEDIA.list();
    expect(media.objects).toEqual([]);
    const stub = stubFor('backfill-meta-bucket-id');
    await stub.upsert(descriptorOf('bf-guard/a.txt', { bucketId: 'media' }));

    await stub.startBackfill('media');
    await waitForBackfill(stub);

    await expect(stub.debugMeta(BUCKET_ID_KEY)).resolves.toBe('media');
    await expect(async () => stub.upsert(descriptorOf('bf-guard/b.txt', { bucketId: 'photos' }))).rejects.toThrow(/bound to bucket "media" but received "photos"/);
  });

  // Ruling 20 / Ruling 16: 索引に書く contentType は R2 の httpMetadata ではなく
  // r2/list.ts の contentTypeOf(key)(拡張子由来)から取る。R2 一覧経路と同じ関数を
  // 通すことで、indexed の有無で同じキーの contentType が変わらないようにする。
  //
  // 拡張子(.txt → text/plain)と httpMetadata(image/jpeg)をわざと食い違わせている。
  // httpMetadata を見る実装に戻すと、include を付ければ image/jpeg、include 無しなら
  // undefined → application/octet-stream になり、どちらでもこの行が落ちる。
  it('索引に書く contentType は httpMetadata ではなく拡張子由来', async () => {
    await putDirectly('bf-ct/note.txt', 'image/jpeg');
    const stub = stubFor('backfill-content-type');

    await stub.startBackfill('photos');
    await waitForBackfill(stub);

    await expect(stub.debugRow('bf-ct/note.txt')).resolves.toMatchObject({ contentType: 'text/plain' });
  });

  // Ruling 21: 0 バイトのフォルダマーカーも除外せず upsert する。R2 にマーカーが実在する
  // 以上、索引も R2 の現在状態を映すべきである。表示側は list(Ruling 14)が既に除外
  // しているので利用者には見えない。マーカー由来の prefixes 行が作られるのも正しい
  // (そのフォルダは実在する)。
  it('0 バイトのフォルダマーカーも索引に入り、一覧からは除外される', async () => {
    await putDirectly('bf-marker/', 'application/octet-stream');
    await putDirectly('bf-marker/a.txt', 'text/plain');
    const stub = stubFor('backfill-marker');

    await stub.startBackfill('photos');
    await waitForBackfill(stub);

    await expect(stub.debugRow('bf-marker/')).resolves.toMatchObject({ name: '', parentPrefix: 'bf-marker/' });
    const page = await stub.list({ bucketId: 'photos', prefix: 'bf-marker/', cursor: undefined, limit: 10 });
    expect(page.objects.map((o) => o.key)).toEqual(['bf-marker/a.txt']);
  });

  // 組み込みの alarm リトライは指数バックオフで 6 回、その後は何も残らずに消える。
  // 回復不能な失敗(バケット定義が消えている等)を例外で投げっぱなしにすると、
  // 6 回無駄に走った末に「静かに途中で終わった索引」だけが残る。状態に記録して止める。
  it('存在しないバケットは failed になり alarm を再予約しない', async () => {
    const stub = stubFor('backfill-unknown-bucket');

    await stub.startBackfill('nope');
    await waitForBackfill(stub);

    await expect(stub.status()).resolves.toMatchObject({ kind: 'failed', reason: expect.stringContaining('nope') });
    // 「止める」側を実際に張る。予約が残っていると 6 回のリトライを無駄に消費した末に
    // 何の記録も残さず消える。
    await expect(stub.debugAlarm()).resolves.toBeNull();
  });

  // 運用手順「status を見る → 原因を直す → backfill を叩き直す」を固定する。
  // 運用の口の存在意義そのものなので、実装が偶然そうなっているだけの状態にしない。
  it('failed から叩き直すと complete まで復帰する', async () => {
    await putDirectly('bf-recover/1.txt', 'text/plain');
    const stub = stubFor('backfill-recover');

    await stub.startBackfill('nope');
    await waitForBackfill(stub);
    await expect(stub.status()).resolves.toMatchObject({ kind: 'failed' });

    await stub.startBackfill('photos');
    await waitForBackfill(stub);

    await expect(stub.status()).resolves.toMatchObject({ kind: 'complete' });
    await expect(stub.debugRow('bf-recover/1.txt')).resolves.toMatchObject({ name: '1.txt', parentPrefix: 'bf-recover/' });
  });

  // alarm は at-least-once。complete に着いた後の迷い alarm がバケット全体を再スキャン
  // したり、状態を書き換えたりしてはいけない(failed を complete に上書きすると
  // 「索引を信じてよいか」の判断を誤る)。
  //
  // backfill_bucket_id は完了後も残るので、「出典があるか」では弾けない。状態で弾く。
  // 行数は upsert が冪等なので再スキャンしても増えない — **ページ数だけが再スキャンを
  // 検出できる**。ガードを消すとここが 1 から 2 に増えて落ちる。
  it('complete 後に迷い alarm が来ても状態・行数・ページ数が動かない', async () => {
    await putDirectly('bf-stray/1.txt', 'text/plain');
    const stub = stubFor('backfill-stray-alarm');
    await stub.startBackfill('photos');
    await waitForBackfill(stub);
    const status = await stub.status();
    const count = await stub.count();
    const pages = await stub.debugMeta(BACKFILL_PAGES_KEY);

    await runInDurableObject(stub, async (instance) => instance.alarm());

    await expect(stub.status()).resolves.toEqual(status);
    await expect(stub.count()).resolves.toBe(count);
    await expect(stub.debugMeta(BACKFILL_PAGES_KEY)).resolves.toBe(pages);
  });
});
