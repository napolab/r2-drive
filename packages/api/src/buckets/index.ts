import { zValidator } from '@hono/zod-validator';
import { ObjectNotFoundError, R2OperationError } from '@r2-drive/core';
import { Hono } from 'hono';
import { ResultAsync } from 'neverthrow';
import { z } from 'zod';

import { toErrorResponse } from '../errors/to-error-response';
import { indexRemove, resolveObjectIndex } from '../object-index/registry';
import { deleteObject } from '../r2/delete';
import { resolveObjectSource } from '../plugins/object-source/registry';
import { getObject } from '../r2/get';
import { parseRangeHeader, resolveContentRange } from '../r2/range';
import { bucketDescriptors, resolveBucket } from '../r2/registry';

import type { HonoEnv } from '../env';
import type { BackfillStatus } from '../object-index/status';
import type { DriveError, ObjectPage } from '@r2-drive/core';

// prefix は空文字か末尾 '/' のどちらかしか許さない。R2 経路(r2/list.ts の listObjects)は
// delimiter: '/' の R2.list() に prefix をそのまま渡すので 'ab' のような末尾なし prefix でも
// 前方一致で 1 件返るが、索引経路(object-index/index.ts の list)は
// `eq(objects.parentPrefix, input.prefix)` で完全一致するため、parentPrefix が必ず
// '/' 終わり(または空文字)である以上、末尾なし prefix には永久にマッチしない
// (最終レビュー M1、実測: `?prefix=ab` で `abc.txt` を置くと R2 経路は 1 件、索引経路は 0 件)。
// クライアント(apps/web/src/queries/objects.ts の toPrefix)側の正規化はガードにならない
// (直接 API を叩けば踏める)ので、両経路が同じ 400 で揃うようここで弾く。
const listQuery = z.object({ prefix: z.string().default(''), cursor: z.string().optional() }).refine((query) => query.prefix === '' || query.prefix.endsWith('/'), {
  message: 'prefix must be empty or end with "/"',
  path: ['prefix'],
});
const searchQuery = z.object({ q: z.string().min(1), cursor: z.string().optional() });

// 検索結果は一覧より小さいページで返す。全件を舐める用途ではないため。
// INDEX_PAGE_SIZE(一覧用、1000)とは目的が違うので流用しない。
const SEARCH_PAGE_SIZE = 100;

// content-addressed URL のバージョン。クライアントは ObjectDescriptor.etag(= httpEtag、
// 引用符付き)をそのまま載せるので、ここでも引用符付きの文字列として素通しする。
// クエリ文字列なので存在しないことがある。
const contentQuery = z.object({ v: z.string().optional() });

// v が現在の etag と一致する = URL がその中身だけを指しているので、無期限に固めてよい。
// 上書きされれば etag が変わり URL も変わるため stale にならない。
// Access 配下の非公開ファイルなので private を外さないこと(共有プロキシに保存させない)。
const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'private, no-cache';

export const buckets = new Hono<HonoEnv>()
  .get('/', (c) => c.json({ buckets: bucketDescriptors.map(({ id, label }) => ({ id, label })) }, 200))
  .get('/:bucketId/objects', zValidator('query', listQuery), async (c) => {
    const { prefix, cursor } = c.req.valid('query');
    const request = { env: c.env, bucketId: c.req.param('bucketId'), prefix, cursor };

    return resolveObjectSource(request).match(
      (work) =>
        work.match(
          (page) => c.json(page, 200),
          (error) => toErrorResponse(c, error),
        ),
      (input) => toErrorResponse(c, new Error(`no object source for bucket: ${input.bucketId}`)),
    );
  })
  // 索引を直接読む唯一の GET エンドポイント。indexed フラグでは分岐しない
  // (indexed: false のバケットでも Task 8 により索引には行が書かれているため、
  // 検索は先に索引を使える。切り替え前の動作確認手段としても価値がある)。
  // ただし、バックフィル前は既存オブジェクトが索引に無いため検索結果は不完全になりうる。
  //
  // 'search' は 2 番目のセグメントが literal なので、'/:bucketId/objects' や
  // '/:bucketId/content/:path{.+}' とは衝突しない。一覧系の GET とまとめて扱う意味で
  // '/:bucketId/objects' の直後に置く。
  //
  // Ruling 17(実測日 2026-08-17、test/search.integration.test.ts で固定): FTS5 の
  // 既定 tokenizer(unicode61)は連続する CJK 文字列全体を 1 トークン化し、単語分割
  // しない。そのため日本語クエリは、連続する非 ASCII ランの「先頭一致」しか引けない
  // (例: 「休暇の写真.jpg」に対し「休暇の写真」「休暇」はヒットするが、「写真」(末尾)
  // 「暇の写」(中間)はヒットしない)。tokenize = 'trigram' に変えても解決しない
  // (FTS5 の trigram は 3 文字未満のクエリにマッチしないため、「写真」のような
  // 2 文字の日本語クエリはそもそも構成できず引けない)。この実測値が spec の
  // 「Phase 5(Vectorize 意味検索)の要否は FTS5 を実際に使ってから判断する」の
  // 判断材料である。
  .get('/:bucketId/search', zValidator('query', searchQuery), async (c) => {
    const { q, cursor } = c.req.valid('query');
    const bucketId = c.req.param('bucketId');

    return resolveObjectIndex(c.env, bucketId)
      .asyncAndThen((stub) =>
        ResultAsync.fromPromise<ObjectPage, DriveError>(stub.search({ bucketId, query: q, cursor, limit: SEARCH_PAGE_SIZE }), (cause) => new R2OperationError(`index search failed: ${q}`, { cause })),
      )
      .match(
        (page) => c.json(page, 200),
        (error) => toErrorResponse(c, error),
      );
  })
  // 運用の口。索引を後から有効化する / R2 に直接置かれたオブジェクトを取り込む /
  // uploads/index.ts の multipart complete が取りこぼした分を回復する、いずれも
  // この 2 本で行う。バックフィルは冪等なので、迷ったら叩いてよい。
  //
  // **indexed: true への切り替えはここから行わない。**索引を信じるかどうかは deploy 時の
  // 設定(r2/registry.ts の bucketDescriptors.indexed)であり、実行時に書き換えられる
  // ようにすると「deploy 時の設定である」という前提が崩れる。運用手順は
  // 「backfill を叩く → status が complete になるのを確認する → registry を書き換えて再デプロイ」。
  //
  // 'index' は 2 番目のセグメントが literal なので '/:bucketId/objects'(完全一致)や
  // '/:bucketId/content/:path{.+}'(2 番目が 'content')とは衝突しないが、splat を持つ
  // ルートより前に置いて順序に依存しない形にしておく。
  .post('/:bucketId/index/backfill', async (c) => {
    const bucketId = c.req.param('bucketId');

    return resolveObjectIndex(c.env, bucketId)
      .asyncAndThen((stub) => ResultAsync.fromPromise<BackfillStatus, DriveError>(stub.startBackfill(bucketId), (cause) => new R2OperationError(`backfill start failed: ${bucketId}`, { cause })))
      .match(
        // 202。受け付けて alarm を予約しただけで、走り切ってはいない。進捗は status を見る。
        (status) => c.json(status, 202),
        (error) => toErrorResponse(c, error),
      );
  })
  .get('/:bucketId/index/status', async (c) => {
    const bucketId = c.req.param('bucketId');

    return resolveObjectIndex(c.env, bucketId)
      .asyncAndThen((stub) => ResultAsync.fromPromise<BackfillStatus, DriveError>(stub.status(), (cause) => new R2OperationError(`backfill status failed: ${bucketId}`, { cause })))
      .match(
        (status) => c.json(status, 200),
        (error) => toErrorResponse(c, error),
      );
  })
  .get('/:bucketId/content/:path{.+}', zValidator('query', contentQuery), async (c) => {
    const key = c.req.param('path');
    const { v } = c.req.valid('query');

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) => {
        const head = await bucket.head(key);
        if (head === null) return toErrorResponse(c, new ObjectNotFoundError(key));

        const spec = parseRangeHeader(c.req.header('range') ?? null, head.size);
        if (spec.kind === 'unsatisfiable') {
          return c.body(null, 416, { 'content-range': `bytes */${head.size}`, 'accept-ranges': 'bytes' });
        }

        return getObject(bucket, key, spec).match(
          (object) => {
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set('accept-ranges', 'bytes');
            headers.set('etag', object.httpEtag);
            // writeHttpMetadata の後に置く。R2 の httpMetadata.cacheControl を必ず上書きするため。
            // バイト範囲は etag に対して不変なので、206 でも同じ判定でよい。
            headers.set('cache-control', v === object.httpEtag ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL);

            // R2 に渡した range はこの spec そのものなので、応答ヘッダも spec から直接計算する
            // (object.range を読み返すと 3 変分の判別可能ユニオンが `in` では narrow しきれない)。
            // start/end/length の算術自体は range.ts の resolveContentRange に抽出済み(単体テストあり)。
            const range = resolveContentRange(spec, head.size);
            headers.set('content-length', `${range.length}`);

            switch (spec.kind) {
              case 'whole':
                return new Response(object.body, { status: 200, headers });
              case 'offset':
              case 'window':
              case 'suffix':
                headers.set('content-range', `bytes ${range.start}-${range.end}/${range.total}`);

                return new Response(object.body, { status: 206, headers });
              default: {
                const _exhaustive: never = spec;
                throw new Error(`unhandled range spec: ${JSON.stringify(_exhaustive)}`);
              }
            }
          },
          (error) => toErrorResponse(c, error),
        );
      },
      async (error) => toErrorResponse(c, error),
    );
  })
  .delete('/:bucketId/objects/:path{.+}', async (c) => {
    const key = c.req.param('path');
    const bucketId = c.req.param('bucketId');

    return resolveBucket(c.env, bucketId).match(
      async (bucket) =>
        deleteObject(bucket, key)
          .andThen((deleted) => indexRemove(c.env, bucketId, key).map(() => deleted))
          .match(
            (deleted) => c.json({ deleted }, 200),
            (error) => toErrorResponse(c, error),
          ),
      async (error) => toErrorResponse(c, error),
    );
  });
