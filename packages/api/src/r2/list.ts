import { R2OperationError } from '@r2-drive/core';
import { fromPromise } from 'neverthrow';
import mime from 'mime';

import type { DriveError, ObjectPage, Prefix } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

const nameOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

// contentType は常に拡張子から確定させる。R2 に保存済みの httpMetadata は参照しない。
//
// 理由: list() に include: ['httpMetadata'] を付けると R2 がレスポンス全体のデータ量で
// 打ち切り、limit をいくつにしても 1 ページ 100 件に丸められる(実測: limit 1000 + include
// で 100 件、include 無しで 1000 件)。10,000 件のフォルダで 100 往復になり、1 ページ
// 追加ごとにクライアントのコレクション再構築が走るため往復数がそのまま体感に効く。
//
// 代償: R2 に保存された httpMetadata.contentType が拡張子と食い違っていても拡張子が勝つ。
// 一覧のアイコン/プレビュー判定にしか使わないので許容する。正確な contentType が要るのは
// 単体取得(get.ts)側で、そちらは head()/get() が httpMetadata をそのまま返す。
//
// export する理由(Ruling 16): 索引(object-index)に書き込む contentType もこの関数から
// 導出する。索引書き込み側がリクエストの content-type ヘッダをそのまま書くと、同じキーが
// indexed の有無で違う contentType を返してしまう(例: photo.bin を content-type: image/jpeg
// でアップロードすると、R2 経路は application/octet-stream、索引経路は image/jpeg になる)。
// 同じ関数を通すことで構造的に一致させる。
export const contentTypeOf = (key: string): string => mime.getType(key) ?? 'application/octet-stream';

// limit は呼び出し元から注入する。モジュール定数にすると truncated 経路をテストで作れない。
export type ListInput = { readonly bucket: R2Bucket; readonly bucketId: string; readonly prefix: Prefix; readonly cursor: string | undefined; readonly limit: number };

// exactOptionalPropertyTypes 下では cursor: undefined を明示的に渡せない。
// cursor キー自体を spread の有無で作るかどうか分岐する。
const listOptionsOf = (input: ListInput): R2ListOptions => ({
  prefix: input.prefix,
  delimiter: '/',
  limit: input.limit,
  ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
});

export const listObjects = (input: ListInput): ResultAsync<ObjectPage, DriveError> =>
  fromPromise(input.bucket.list(listOptionsOf(input)), (cause) => new R2OperationError(`list failed: ${input.prefix}`, { cause })).map((listed) => ({
    // delimitedPrefixes が「フォルダ」の正体。ディレクトリという実体は R2 に無い。
    folders: listed.delimitedPrefixes.map((prefix) => ({ bucketId: input.bucketId, prefix, name: nameOf(prefix.slice(0, -1)) })),
    objects: listed.objects
      // prefix そのものを表す 0 バイトのマーカーは一覧に出さない
      .filter((object) => object.key !== input.prefix)
      .map((object) => ({
        bucketId: input.bucketId,
        key: object.key,
        name: nameOf(object.key),
        contentType: contentTypeOf(object.key),
        size: object.size,
        uploadedAt: object.uploaded.toISOString(),
        etag: object.httpEtag,
      })),
    next: listed.truncated ? { kind: 'more', cursor: listed.cursor } : { kind: 'end' },
  }));
