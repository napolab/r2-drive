import { NO_MEDIA, R2OperationError, UploadSessionError } from '@r2-drive/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { fromPromise } from 'neverthrow';
import { z } from 'zod';

import { toErrorResponse } from '../errors/to-error-response';
import { keyPartsOf } from '../object-index/key-parts/index';
import { indexUpsert } from '../object-index/registry';
import { contentTypeOf } from '../r2/list';
import { resolveBucket } from '../r2/registry';

import type { HonoEnv } from '../env';

const MAX_PARTS = 10_000;

const createBody = z.object({ key: z.string().min(1), contentType: z.string().min(1) });
const completeBody = z.object({
  key: z.string().min(1),
  parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) })).min(1),
});
const keyQuery = z.object({ key: z.string().min(1) });

export const uploads = new Hono<HonoEnv>()
  .put('/:bucketId/single', zValidator('query', keyQuery), async (c) => {
    const body = c.req.raw.body ?? new Uint8Array(0);
    const requestContentType = c.req.header('content-type');
    const contentType = requestContentType === undefined || requestContentType === '' ? 'application/octet-stream' : requestContentType;

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) =>
        fromPromise(bucket.put(c.req.valid('query').key, body, { httpMetadata: { contentType } }), (cause) => new R2OperationError('single upload failed', { cause }))
          .andThen((object) => {
            const bucketId = c.req.param('bucketId');
            const { name } = keyPartsOf(object.key);

            // indexUpsert が失敗すると、この直前の bucket.put はすでに成功している。
            // それでも R2 の書き込みは巻き戻さない(spec の原則: R2 が真実である。
            // 索引は後付けの読み取り加速層であり、壊れていても一覧は出続けること)。
            // ここは同じキーへの再アップロードで自己修復できる(multipart complete は
            // uploadId を消費済みで再試行が効かないため事情が異なる。そちらのコメント参照)。
            return indexUpsert(c.env, {
              bucketId,
              key: object.key,
              name,
              // Ruling 16: 索引の contentType はリクエストヘッダではなく拡張子由来
              // (r2/list.ts の contentTypeOf)にする。R2 一覧経路と揃えるため。
              contentType: contentTypeOf(object.key),
              size: object.size,
              uploadedAt: object.uploaded.toISOString(),
              etag: object.httpEtag,
              // R2 は寸法を知らない。索引列からの導出は Task 2。
              media: NO_MEDIA,
            }).map(() => object);
          })
          .match(
            (object) => c.json({ key: object.key, etag: object.httpEtag }, 200, { etag: object.httpEtag }),
            (error) => toErrorResponse(c, error),
          ),
      async (error) => toErrorResponse(c, error),
    );
  })
  .post('/:bucketId', zValidator('json', createBody), async (c) => {
    const { key, contentType } = c.req.valid('json');

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) =>
        fromPromise(bucket.createMultipartUpload(key, { httpMetadata: { contentType } }), (cause) => new UploadSessionError('aborted', { cause })).match(
          (upload) => c.json({ uploadId: upload.uploadId, key: upload.key }, 200),
          (error) => toErrorResponse(c, error),
        ),
      async (error) => toErrorResponse(c, error),
    );
  })
  // サーバー側にセッション状態を持たない。uploadId さえあればどのインスタンスからでもパートを受けられる。
  .put('/:bucketId/:uploadId/parts/:partNumber', zValidator('query', keyQuery), async (c) => {
    const partNumber = parseInt(c.req.param('partNumber'), 10);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
      return toErrorResponse(c, new UploadSessionError('too-many-parts'));
    }
    const body = c.req.raw.body;
    if (body === null) return toErrorResponse(c, new UploadSessionError('part-too-small'));

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) => {
        const upload = bucket.resumeMultipartUpload(c.req.valid('query').key, c.req.param('uploadId'));

        return fromPromise(upload.uploadPart(partNumber, body), (cause) => new UploadSessionError('unknown-upload-id', { cause })).match(
          // Uppy が ETag ヘッダを読んで complete に渡す。同一オリジンなので CORS 設定は不要。
          (part) => c.body(null, 200, { etag: part.etag }),
          (error) => toErrorResponse(c, error),
        );
      },
      async (error) => toErrorResponse(c, error),
    );
  })
  .post('/:bucketId/:uploadId/complete', zValidator('json', completeBody), async (c) => {
    const { key, parts } = c.req.valid('json');

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) => {
        const upload = bucket.resumeMultipartUpload(key, c.req.param('uploadId'));

        return fromPromise(upload.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))), (cause) => new UploadSessionError('unknown-upload-id', { cause }))
          .andThen((object) => {
            const bucketId = c.req.param('bucketId');
            const { name } = keyPartsOf(object.key);

            // indexUpsert が失敗すると、この直前の upload.complete はすでに成功しており
            // R2 にオブジェクトが存在する。それでも巻き戻さない(単発 PUT と同じく、
            // R2 が真実であるという spec の原則に従う)。索引を先に書いて R2 を後にする
            // 逆順にはしない — その場合「索引にはあるが R2 には無い」状態が起こりえて、
            // 一覧には出るのに開けないオブジェクトという、今より悪い失敗モードになる。
            //
            // ただしここは単発 PUT と事情が異なる: uploadId はこの complete で
            // 消費済みのため、失敗しても同じ uploadId での単純なリトライが効かない。
            // クライアントに返るのは失敗だが R2 には残る、という非対称が生まれる。
            // この場合の回復手段はバックフィル(Task 10)である。バックフィルは
            // 冪等な upsert なので、次回実行時にこの取りこぼしを自然に拾う。
            // **`indexed: true` のバケットでバックフィルを叩くと一覧が最大 3.2 秒ブロックする
            // (reports/2026-08-18-phase-1-index-perf.md の「バックフィル」節)。**
            // 10,000 件規模ならブロックを許容してそのまま叩いてよいが、100,000 件規模
            // では `indexed: false` に落としてから叩くこと(同レポート「切り替えの手順」節、
            // 最終レビュー I2 で運用手順として明記した)。
            return indexUpsert(c.env, {
              bucketId,
              key: object.key,
              name,
              // Ruling 16: 単発 PUT と同じく、拡張子由来の contentType を書く。
              contentType: contentTypeOf(object.key),
              size: object.size,
              uploadedAt: object.uploaded.toISOString(),
              etag: object.httpEtag,
              // R2 は寸法を知らない。索引列からの導出は Task 2。
              media: NO_MEDIA,
            }).map(() => object);
          })
          .match(
            (object) => c.json({ key: object.key, etag: object.httpEtag }, 200),
            (error) => toErrorResponse(c, error),
          );
      },
      async (error) => toErrorResponse(c, error),
    );
  })
  .delete('/:bucketId/:uploadId', zValidator('query', keyQuery), async (c) =>
    resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) =>
        fromPromise(bucket.resumeMultipartUpload(c.req.valid('query').key, c.req.param('uploadId')).abort(), (cause) => new UploadSessionError('unknown-upload-id', { cause })).match(
          () => c.json({ aborted: true }, 200),
          (error) => toErrorResponse(c, error),
        ),
      async (error) => toErrorResponse(c, error),
    ),
  );
