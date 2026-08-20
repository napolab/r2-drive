# ギャラリービュー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** バケットの既定ビューを skyline ギャラリーにする(寸法は ObjectHook + 索引で既知、計測ゼロ・シフトゼロ)。

**Architecture:** サーバ側は `MediaFacts` variant をワイヤ型に追加し、`ObjectHook`(全実行型の明示配列)がアップロード時に寸法を索引へ書く。既存画像はバックフィル完了後の追い掛けフェーズが埋める。クライアント側は参照実装の `pack()` をテストごと移植し、react-aria Virtualizer の custom `SkylineLayout` として既存 GridList に差す(選択・キーボード・ビューア連携は無償で維持)。

**Tech Stack:** Drizzle(DO SQLite)/ image-size(npm、要検証)/ react-aria-components Virtualizer + custom Layout / 参照実装 `napolab/www.napochaan.com` の skyline

**Spec:** `docs/superpowers/specs/2026-08-20-r2-drive-gallery-design.md`(親: `2026-08-14-r2-drive-design.md` §5.2 / §10)

## Global Constraints

- 作業ブランチ: `feat/gallery-view`(作成済み、PR #8 マージ後の main 起点)
- 各タスク完了時に `pnpm lint && pnpm typecheck` を必ず通す。`npx tsc` 禁止
- `let` / `forEach` / IIFE / non-null `!` / `any` 禁止。top-level はアロー関数、class は method shorthand(arrow property は DO RPC に乗らない)
- **optional field 禁止**: 寸法は `MediaFacts = { kind: 'image'; width; height } | { kind: 'none' }` の variant。`width?` を作らない
- **hook は全実行型**: `createRunner`(first-match)を使わず明示配列 + for-of。理由は spec §4 に明記済み(dispatch と直交)
- 複数文の書き込みは `db.transaction()` で囲う(bare 連続 sql.exec は非原子 — Phase 1 spec §12 リスク 2)
- `meta` テーブルはキー単位でのみ触る(bucket_id 同居のため一括クリア禁止)
- 索引書き込みの失敗でリクエスト/バックフィルを落とさない(「R2 が真実、索引は飾り」)。寸法抽出の失敗で索引書き込みを落とさない(spec §3.3)
- Panda strictTokens、コンポーネント 3 ファイル構成、リンクは react-aria `Link`
- pool-workers テストは実 R2 / 実 DO(packages/api/test/ の既存パターンに従う)
- commit メッセージは日本語 + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。`git pull/fetch/push` はしない(controller が行う)

---

### Task 1: `MediaFacts` ワイヤ型と全 descriptor 生成箇所の更新

**Files:**
- Modify: `packages/core/src/object-descriptor.ts`(`MediaFacts` 追加、`ObjectDescriptor.media` 追加)
- Modify: `packages/core/src/index.ts`(型 export に `MediaFacts` 追加)
- Modify: `packages/api/src/r2/list.ts`(descriptor 生成に `media: NO_MEDIA`)
- Modify: `packages/api/src/r2/head.ts`(同上)
- Modify: `packages/api/src/uploads/index.ts`(indexUpsert に渡す 2 箇所)
- Modify: `packages/api/src/object-index/index.ts`(`list()` / `search()` の row マップ、`#indexObject` / `#backfillUpsert` 経路)
- Modify: 既存テストの descriptor fixture 全箇所(packages/api/test/、apps/web/src/ の `ObjectDescriptor` リテラル)
- Test: `packages/core/src/object-descriptor.test.ts`(新規)

**Interfaces:**
- Produces:
  ```ts
  export type MediaFacts = { readonly kind: 'image'; readonly width: number; readonly height: number } | { readonly kind: 'none' };
  export const NO_MEDIA: MediaFacts; // = { kind: 'none' } の共有定数(fixture と生成箇所の記述量を抑える)
  export const mediaOf: (width: number | null | undefined, height: number | null | undefined) => MediaFacts;
  // ObjectDescriptor に readonly media: MediaFacts が加わる
  ```
  Task 2(索引列からの導出)、Task 7-8(ratio 計算)が消費

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/object-descriptor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { mediaOf, NO_MEDIA } from './object-descriptor';

describe('mediaOf', () => {
  it('width と height が揃っていれば image variant', () => {
    expect(mediaOf(800, 600)).toEqual({ kind: 'image', width: 800, height: 600 });
  });

  it('どちらかが欠けていれば none', () => {
    expect(mediaOf(null, null)).toEqual(NO_MEDIA);
    expect(mediaOf(800, null)).toEqual(NO_MEDIA);
    expect(mediaOf(undefined, 600)).toEqual(NO_MEDIA);
  });

  it('0 以下は none(壊れた抽出値を variant に昇格させない)', () => {
    expect(mediaOf(0, 600)).toEqual(NO_MEDIA);
    expect(mediaOf(800, -1)).toEqual(NO_MEDIA);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @r2-drive/core exec vitest run` (core にテスト実行が無ければ root の `pnpm test` の core project で)
Expected: FAIL(mediaOf 未定義)

- [ ] **Step 3: 型と helper を実装する**

`packages/core/src/object-descriptor.ts` に追加:

```ts
// 寸法は「画像で、両方分かっている」か「無い」かの 1 つの状態(親 spec §6)。
// width? / height? という 2 つの optional にしない。
export type MediaFacts = { readonly kind: 'image'; readonly width: number; readonly height: number } | { readonly kind: 'none' };

export const NO_MEDIA: MediaFacts = { kind: 'none' };

// DB の NULL 許容 2 列(width / height)からワイヤ variant への境界変換。
// どちらかが欠ける・0 以下は none(半端な値を image に昇格させない)。
export const mediaOf = (width: number | null | undefined, height: number | null | undefined): MediaFacts =>
  typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? { kind: 'image', width, height } : NO_MEDIA;
```

`ObjectDescriptor` に `readonly media: MediaFacts;` を追加。`packages/core/src/index.ts` の型 export に `MediaFacts` を、値 export に `NO_MEDIA, mediaOf` を追加。

- [ ] **Step 4: 全生成箇所に `media` を配線する**

required フィールド追加なのでコンパイルが全箇所を列挙してくれる。方針:
- `r2/list.ts` の `listObjects`、`r2/head.ts` の `headObject`、`uploads/index.ts` の indexUpsert 2 箇所、`object-index/index.ts` の `#indexObject`: `media: NO_MEDIA`(R2 は寸法を知らない。索引列からの導出は Task 2)
- `object-index/index.ts` の `list()` / `search()` row マップ: 一旦 `media: NO_MEDIA`(Task 2 で `mediaOf(row.width, row.height)` に置換する — このタスクでは列がまだ無い)
- テスト fixture: `media: NO_MEDIA`(packages/api/test)/ apps/web 側のリテラル fixture には `media: { kind: 'none' }`(client は `NO_MEDIA` 定数を import してもよい — `@r2-drive/core` は既に依存にある)
- `upsert(object: ObjectDescriptor)` は `media` を受け取るが Task 1 時点では**無視して良い**(列が無い)。コメントで Task 2 参照を残す

- [ ] **Step 5: 全テストを回す**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 全グリーン(fixture 更新漏れは typecheck が列挙する)

- [ ] **Step 6: Commit**

```bash
git add packages/ apps/
git commit -m "feat(core): ObjectDescriptor に MediaFacts variant を追加する(全経路は一旦 none)"
```

---

### Task 2: 索引スキーマに width / height 列 + `setMediaFacts` RPC

**Files:**
- Modify: `packages/api/src/object-index/schema.ts`(objects テーブル定義 + DDL)
- Modify: `packages/api/src/object-index/sqlite-store.ts`(冪等 ALTER の適用)
- Modify: `packages/api/src/object-index/index.ts`(`upsert` が media を書く、`list`/`search` が media を返す、`setMediaFacts` RPC)
- Modify: `packages/api/test/worker-entry.ts`(テストサブクラスに必要なら追加)
- Test: `packages/api/test/media-facts.integration.test.ts`(新規)

**Interfaces:**
- Consumes: Task 1 の `mediaOf` / `NO_MEDIA` / `MediaFacts`
- Produces: DO RPC `setMediaFacts(key: string, width: number, height: number): Promise<void>`(行が無ければ何もしない)。`upsert` は `object.media.kind === 'image'` なら width/height 列も書く。`list()` / `search()` の descriptor が `media: mediaOf(row.width, row.height)` を返す。Task 4-5 が消費

- [ ] **Step 1: 失敗する integration test を書く**

`packages/api/test/media-facts.integration.test.ts`(既存テストの DO 直叩きパターン — `object-index-namespace.ts` を参照して同じ流儀で):

```ts
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { NO_MEDIA } from '@r2-drive/core';

import { objectIndexStub } from './object-index-namespace';

import type { ObjectDescriptor } from '@r2-drive/core';

const descriptor = (key: string, media: ObjectDescriptor['media'] = NO_MEDIA): ObjectDescriptor => ({
  bucketId: 'photos',
  key,
  name: key,
  contentType: 'image/png',
  size: 1,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  etag: '"x"',
  media,
});

describe('MediaFacts の索引列', () => {
  it('media: image 付きの upsert は列に書き、list が variant で返す', async () => {
    const stub = objectIndexStub('photos-media-1');
    await stub.upsert(descriptor('a.png', { kind: 'image', width: 800, height: 600 }));
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 800, height: 600 });
  });

  it('media: none の upsert 後、setMediaFacts で後から埋められる', async () => {
    const stub = objectIndexStub('photos-media-2');
    await stub.upsert(descriptor('b.png'));
    await stub.setMediaFacts('b.png', 1920, 1080);
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 1920, height: 1080 });
  });

  it('setMediaFacts は行が無ければ何もしない(削除との競合に安全)', async () => {
    const stub = objectIndexStub('photos-media-3');
    await stub.setMediaFacts('missing.png', 10, 10); // throw しない
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects).toEqual([]);
  });

  it('media 無しの upsert が既存の寸法を消さない(索引書き直しで寸法が退行しない)', async () => {
    const stub = objectIndexStub('photos-media-4');
    await stub.upsert(descriptor('c.png', { kind: 'image', width: 800, height: 600 }));
    await stub.upsert(descriptor('c.png')); // 再アップロード相当、寸法未知
    const page = await stub.list({ bucketId: 'photos', prefix: '', cursor: undefined, limit: 10 });
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 800, height: 600 });
  });
});
```

`objectIndexStub` が無ければ既存 namespace helper の流儀に合わせて書く(既存テストを読むこと)。stub の list 呼び出しシグネチャは実物(`IndexListInput`)に合わせて調整。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @r2-drive/api test -- media-facts`
Expected: FAIL(列・RPC 未実装)

- [ ] **Step 3: スキーマを拡張する**

`schema.ts`: `objects` テーブル定義に `width: integer('width'), height: integer('height'),`(NOT NULL を付けない)。DDL 配列の `CREATE TABLE objects` にも `width INTEGER, height INTEGER` を追加(新規 DO 用)。**既存 DO 用の冪等 ALTER** を DDL とは別 export で:

```ts
// 既存 DO への後付け列。SQLite に ADD COLUMN IF NOT EXISTS は無いので、
// 適用側(SqliteStore)が PRAGMA table_info で列の有無を見てから流す。
export const OBJECTS_MEDIA_COLUMNS: readonly { readonly name: string; readonly ddl: string }[] = [
  { name: 'width', ddl: `ALTER TABLE objects ADD COLUMN width INTEGER` },
  { name: 'height', ddl: `ALTER TABLE objects ADD COLUMN height INTEGER` },
];
```

`sqlite-store.ts` の blockConcurrencyWhile 内、DDL 適用の後に:

```ts
const columns = new Set([...ctx.storage.sql.exec(`PRAGMA table_info(objects)`)].map((row) => `${row.name}`));
for (const column of OBJECTS_MEDIA_COLUMNS) {
  if (!columns.has(column.name)) ctx.storage.sql.exec(column.ddl);
}
```

- [ ] **Step 4: DO 側を実装する**

`object-index/index.ts`:
- `upsert()` の `updates` に条件付きで寸法を足す。**media が none のときは列を触らない**(既存値を保持 — Step 1 の 4 番目のテスト):

```ts
const mediaUpdates = object.media.kind === 'image' ? { width: object.media.width, height: object.media.height } : {};
const updates = { name, parentPrefix, contentType: object.contentType, size: object.size, uploadedAt: object.uploadedAt, etag: object.etag, ...mediaUpdates };
```

- `list()` / `search()` の row マップを `media: mediaOf(row.width, row.height)` に置換(Task 1 の暫定 NO_MEDIA を差し替え)
- RPC 追加(method shorthand):

```ts
// 寸法の後付け(ObjectHook の mediaFacts / バックフィル追い掛けが使う)。
// 行が無ければ何もしない: 抽出中に削除されたキーへの UPDATE は 0 行更新で終わるのが正しい。
setMediaFacts(key: string, width: number, height: number): void {
  this.db.update(objects).set({ width, height }).where(eq(objects.key, key)).run();
}
```

- [ ] **Step 5: PASS + 全体を確認**

Run: `pnpm --filter @r2-drive/api test -- media-facts`、その後 `pnpm test && pnpm lint && pnpm typecheck`
Expected: 全グリーン(既存 backfill/race テストが列追加で壊れないこと)

- [ ] **Step 6: Commit**

```bash
git add packages/api/
git commit -m "feat(api): 索引に width / height 列と setMediaFacts RPC を追加する"
```

---

### Task 3: 寸法抽出モジュール

**Files:**
- Create: `packages/api/src/media/dimensions.ts`
- Create: `packages/api/test/dimensions.integration.test.ts`
- Modify: `packages/api/package.json`(依存追加)

**Interfaces:**
- Produces:
  ```ts
  export const DIMENSION_PROBE_BYTES = 131_072; // 128 KiB
  export type ImageDimensions = { readonly width: number; readonly height: number };
  // 画像でない / 解析不能 / 読み取り失敗は ok(undefined)ではなく err にしない —
  // 「寸法が得られなかった」は正常系。R2 の読み取り自体の失敗だけ err。
  export const probeImageDimensions: (bucket: R2Bucket, key: string) => ResultAsync<ImageDimensions | undefined, DriveError>;
  ```
  Task 4(hook)と Task 5(追い掛け)が消費

- [ ] **Step 1: image-size の Workers 互換を検証して依存を追加する**

```bash
pnpm --filter @r2-drive/api add image-size@^2.0.2
```

installed の `.d.ts` と README で確認すること: v2 は `import { imageSize } from 'image-size'` が `Uint8Array` を受け、`{ width, height, type }` を返す(同期・Node API 非依存)。Buffer 必須や fs 依存が判明したら、`png / jpeg / gif / webp` の 4 形式のヘッダ自前パースに切り替え、spec §3.3 に「なぜ既製品を使わないか」を追記する(その場合も本タスク内で完結させる)。

- [ ] **Step 2: 失敗するテストを書く**

`packages/api/test/dimensions.integration.test.ts`。fixture は**実バイトを生成**する(base64 リテラルの最小画像。1x1 PNG は既知の 67 バイト、JPEG/GIF/WebP も既知の最小バイナリを使う — 実装時に生成コードで作ってよい: 例えば PNG は下記リテラル):

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { probeImageDimensions } from '../src/media/dimensions';

// 1x1 red PNG (67 bytes)
const PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('probeImageDimensions', () => {
  it('PNG の寸法を先頭バイトから読む', async () => {
    await env.BUCKET_MEDIA.put('probe/a.png', PNG_1x1);
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/a.png');
    expect(result.isOk() && result.value).toEqual({ width: 1, height: 1 });
  });

  it('画像でないバイト列は undefined(err ではない)', async () => {
    await env.BUCKET_MEDIA.put('probe/b.txt', 'not an image');
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/b.txt');
    expect(result.isOk() && result.value).toBeUndefined();
  });

  it('存在しないキーは undefined(削除との競合に安全)', async () => {
    const result = await probeImageDimensions(env.BUCKET_MEDIA, 'probe/missing.png');
    expect(result.isOk() && result.value).toBeUndefined();
  });
});
```

(JPEG / WebP / GIF の各 1 ケースも追加する — 最小バイナリは実装時に生成し、コメントに形式を明記。SOF が 128KiB より後ろにある巨大 JPEG の「取れない → undefined」ケースはバイト生成が大掛かりなのでテスト対象外とし、コメントで断る)

- [ ] **Step 3: FAIL を確認**

Run: `pnpm --filter @r2-drive/api test -- dimensions`
Expected: FAIL(モジュール未実装)

- [ ] **Step 4: 実装する**

`packages/api/src/media/dimensions.ts`:

```ts
import { R2OperationError } from '@r2-drive/core';
import { fromPromise } from 'neverthrow';
import { imageSize } from 'image-size';

import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

// ヘッダ解析に読む先頭バイト数。png/gif/webp はヘッダ先頭、jpeg の SOF も
// 実用上ほぼこの範囲に収まる。取れなければ「寸法なし」に倒す(spec §3.3)。
export const DIMENSION_PROBE_BYTES = 131_072;

export type ImageDimensions = { readonly width: number; readonly height: number };

const parseDimensions = (bytes: Uint8Array): ImageDimensions | undefined => {
  try {
    const { width, height } = imageSize(bytes);
    return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? { width, height } : undefined;
  } catch {
    // image-size は未対応形式・壊れた入力で throw する。「寸法が得られない」は正常系。
    return undefined;
  }
};

export const probeImageDimensions = (bucket: R2Bucket, key: string): ResultAsync<ImageDimensions | undefined, DriveError> =>
  fromPromise(bucket.get(key, { range: { offset: 0, length: DIMENSION_PROBE_BYTES } }), (cause) => new R2OperationError(`dimension probe failed: ${key}`, { cause })).map(async (object) =>
    object === null ? undefined : parseDimensions(new Uint8Array(await object.arrayBuffer())),
  );
```

(`map` 内 async の型が ResultAsync に畳めない場合は `andThen` + `fromPromise` に組み替える — neverthrow の型に従うこと。try/catch はサードパーティが throw する境界の吸収なので許容、エラーを値に変換している)

- [ ] **Step 5: PASS + 全体確認 + Commit**

```bash
pnpm --filter @r2-drive/api test -- dimensions && pnpm test && pnpm lint && pnpm typecheck
git add packages/api/ pnpm-lock.yaml
git commit -m "feat(api): R2 先頭バイトから画像寸法を読む probeImageDimensions を実装する"
```

---

### Task 4: `ObjectHook` 導入と uploads / delete の hook 化

**Files:**
- Create: `packages/api/src/hooks/object-hook/types.ts`
- Create: `packages/api/src/hooks/object-hook/index-write/index.ts`
- Create: `packages/api/src/hooks/object-hook/media-facts/index.ts`
- Create: `packages/api/src/hooks/object-hook/registry.ts`
- Modify: `packages/api/src/uploads/index.ts`(single PUT / multipart complete の indexUpsert 直書きを hook 実行に置換)
- Modify: `packages/api/src/buckets/index.ts`(delete の indexRemove を hook 実行に置換)
- Test: `packages/api/test/object-hook.integration.test.ts`(新規)

**Interfaces:**
- Consumes: Task 1 の `ObjectDescriptor.media`、Task 2 の `setMediaFacts`、Task 3 の `probeImageDimensions`、既存 `indexUpsert` / `indexRemove` / `resolveObjectIndex`
- Produces:
  ```ts
  export type ObjectHookEvent =
    | { readonly kind: 'uploaded'; readonly env: Env; readonly bucket: R2Bucket; readonly descriptor: ObjectDescriptor }
    | { readonly kind: 'removed'; readonly env: Env; readonly bucketId: string; readonly key: string };
  export type ObjectHook = { readonly id: string; run(event: ObjectHookEvent): ResultAsync<void, DriveError> };
  export const objectHooks: readonly ObjectHook[]; // [indexWriteHook, mediaFactsHook]
  export const runObjectHooks: (event: ObjectHookEvent) => Promise<void>; // 全実行・失敗は console.error + 続行
  ```
  Task 5 は hook を使わない(DO 内部)。ルート 3 箇所が `runObjectHooks` を消費

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/test/object-hook.integration.test.ts`(API 経由の end-to-end — hook は実装詳細なのでルート越しに検証する):

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

import type { ObjectPage } from '@r2-drive/core';

// 1x1 PNG(Task 3 と同じバイト。共有 fixture 化してよい: test/fixtures/images.ts)
import { PNG_1x1 } from './fixtures/images';

describe('ObjectHook(uploaded / removed)', () => {
  it('画像のアップロードで索引に寸法まで入る', async () => {
    const res = await api.request('/buckets/photos/uploads/single?key=hook/a.png', { method: 'PUT', body: PNG_1x1, headers: { 'content-type': 'image/png' } }, env);
    expect(res.status).toBe(200);

    const listed = await api.request('/buckets/photos/objects?prefix=hook%2F', {}, env);
    const page = (await listed.json()) as ObjectPage;
    expect(page.objects[0]?.media).toEqual({ kind: 'image', width: 1, height: 1 });
  });

  it('非画像のアップロードは media: none のまま索引に入る', async () => {
    await api.request('/buckets/photos/uploads/single?key=hook/b.txt', { method: 'PUT', body: 'text', headers: { 'content-type': 'text/plain' } }, env);
    const listed = await api.request('/buckets/photos/objects?prefix=hook%2F', {}, env);
    const page = (await listed.json()) as ObjectPage;
    const b = page.objects.find((o) => o.key === 'hook/b.txt');
    expect(b?.media).toEqual({ kind: 'none' });
  });

  it('削除で索引から消える(removed hook)', async () => {
    await api.request('/buckets/photos/uploads/single?key=hook/c.png', { method: 'PUT', body: PNG_1x1, headers: { 'content-type': 'image/png' } }, env);
    await api.request('/buckets/photos/objects/hook/c.png', { method: 'DELETE' }, env);
    const listed = await api.request('/buckets/photos/objects?prefix=hook%2F', {}, env);
    const page = (await listed.json()) as ObjectPage;
    expect(page.objects.some((o) => o.key === 'hook/c.png')).toBe(false);
  });
});
```

uploads の実 URL パス(`/buckets/:bucketId/uploads/single` 等)は `packages/api/src/uploads/index.ts` のルート定義と既存テスト(uploads.integration.test.ts)を読んで正確に合わせること。`photos` は indexed: true バケット(既存テストの前提を確認)。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @r2-drive/api test -- object-hook`
Expected: 1 番目のテストが FAIL(media が none のまま — 寸法 hook がまだ無い)。2-3 番は既存動作で通る可能性がある(それで良い。1 番が RED の本体)

- [ ] **Step 3: hook を実装する**

`types.ts`(上記 Interfaces のとおり。コメントで「全実行型。createRunner(first-match)と直交」を明記)。

`index-write/index.ts`:

```ts
import { indexRemove, indexUpsert } from '../../../object-index/registry';

import type { ObjectHook } from '../types';

// 既存のルート直書きだった索引書き込みを hook 化したもの。挙動は従来と同一。
export const indexWriteHook: ObjectHook = {
  id: 'index-write',
  run(event) {
    switch (event.kind) {
      case 'uploaded':
        return indexUpsert(event.env, event.descriptor);
      case 'removed':
        return indexRemove(event.env, event.bucketId, event.key);
      default: {
        const _exhaustive: never = event;
        throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
      }
    }
  },
};
```

`media-facts/index.ts`:

```ts
import { okAsync, ResultAsync } from 'neverthrow';
import { R2OperationError } from '@r2-drive/core';

import { probeImageDimensions } from '../../../media/dimensions';
import { resolveObjectIndex } from '../../../object-index/registry';

import type { ObjectHook } from '../types';

// 画像なら寸法を抽出して索引の行に書く。removed では何もしない(行ごと消える)。
// index-write の後に走る前提(registry の配列順)。行がまだ無い場合 setMediaFacts は
// 0 行更新で終わる(Task 2 の仕様)。
export const mediaFactsHook: ObjectHook = {
  id: 'media-facts',
  run(event) {
    if (event.kind !== 'uploaded') return okAsync(undefined);
    if (!event.descriptor.contentType.startsWith('image/')) return okAsync(undefined);

    return probeImageDimensions(event.bucket, event.descriptor.key).andThen((dimensions) => {
      if (dimensions === undefined) return okAsync(undefined);

      return resolveObjectIndex(event.env, event.descriptor.bucketId).asyncAndThen((stub) =>
        ResultAsync.fromPromise(stub.setMediaFacts(event.descriptor.key, dimensions.width, dimensions.height), (cause) => new R2OperationError(`setMediaFacts failed: ${event.descriptor.key}`, { cause })),
      );
    });
  },
};
```

`registry.ts`:

```ts
import { indexWriteHook } from './index-write/index';
import { mediaFactsHook } from './media-facts/index';

import type { ObjectHook, ObjectHookEvent } from './types';

// 全 hook を順に実行する(first-match ではない)。順序に意味がある:
// media-facts は index-write が作った行を UPDATE する。
export const objectHooks = [indexWriteHook, mediaFactsHook] as const satisfies readonly ObjectHook[];

// hook の失敗はリクエストを落とさない(R2 が真実、索引は飾り)。
// 各 hook は独立に実行し、1 つの失敗で後続をスキップしない。
// runHooks を分けているのは失敗独立性を単体テストで固定するため(下記 Step 3b)。
export const runHooks = async (hooks: readonly ObjectHook[], event: ObjectHookEvent): Promise<void> => {
  for (const hook of hooks) {
    await hook.run(event).match(
      () => undefined,
      (error) => console.error(`object hook '${hook.id}' failed:`, error),
    );
  }
};

export const runObjectHooks = (event: ObjectHookEvent): Promise<void> => runHooks(objectHooks, event);
```

- [ ] **Step 3b: 失敗独立性の単体テストを書く**

`packages/api/src/hooks/object-hook/registry.test.ts`(spec §8「hook 失敗の独立性」。pool-workers 不要 — 純ロジック):

```ts
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { R2OperationError } from '@r2-drive/core';

import { runHooks } from './registry';

import type { ObjectHook, ObjectHookEvent } from './types';

const event = { kind: 'removed', env: {} as Env, bucketId: 'b', key: 'k' } satisfies ObjectHookEvent;

describe('runHooks', () => {
  it('先行 hook の失敗が後続の実行を止めない', async () => {
    const ran: string[] = [];
    const failing: ObjectHook = { id: 'fail', run: () => errAsync(new R2OperationError('boom')) };
    const following: ObjectHook = {
      id: 'after',
      run() {
        ran.push('after');
        return okAsync(undefined);
      },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runHooks([failing, following], event);
    expect(ran).toEqual(['after']);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('全 hook 成功時は何もログしない(テスト出力を汚さない)', async () => {
    const ok: ObjectHook = { id: 'ok', run: () => okAsync(undefined) };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runHooks([ok, ok], event);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 4: ルート 3 箇所を hook 経由に置換する**

- `uploads/index.ts` single PUT: `indexUpsert(c.env, {...}).map(() => object)` を `fromPromise(runObjectHooks({ kind: 'uploaded', env: c.env, bucket, descriptor: {...} }), ...)` 相当に置換。**既存コメント(自己修復の理屈・Ruling 16)は hook 側 or 呼び出し側に保存する**(消さない)。runObjectHooks は throw しないので、`.andThen` チェーンには `fromSafePromise` 的に乗せるか、ハンドラ末尾で `await runObjectHooks(...)` してから応答を作る形に組み替える(既存の応答セマンティクスを変えない: hook が失敗しても 200)
- multipart complete: 同様に置換(descriptor 構築は既存リテラルを流用、`media: NO_MEDIA`)
- `buckets/index.ts` delete: `indexRemove(...)` を `runObjectHooks({ kind: 'removed', ... })` に置換(応答は従来どおり削除結果)

- [ ] **Step 5: PASS + 全体確認**

Run: `pnpm --filter @r2-drive/api test -- object-hook`、その後 `pnpm test && pnpm lint && pnpm typecheck`
Expected: 全グリーン(既存 uploads / delete / index-sync テストの回帰なし — hook 化で挙動が変わっていない証拠)

- [ ] **Step 6: Commit**

```bash
git add packages/api/
git commit -m "feat(api): ObjectHook 拡張点を導入し索引書き込みと寸法抽出の 2 実装を載せる"
```

---

### Task 5: バックフィル media 追い掛けフェーズ

**Files:**
- Modify: `packages/api/src/object-index/index.ts`(alarm に media フェーズ追加、status 拡張)
- Modify: `packages/api/src/object-index/status.ts`(`BackfillStatus` に media 情報)
- Modify: `packages/api/test/worker-entry.ts`(必要ならシーム追加)
- Test: `packages/api/test/media-backfill.integration.test.ts`(新規)

**Interfaces:**
- Consumes: Task 2 の width/height 列、Task 3 の `probeImageDimensions`
- Produces: `BackfillStatus` の `complete` variant に `readonly mediaPending: number`(width IS NULL の image/* 行数)を追加。alarm は索引フェーズ complete 後、mediaPending が 0 になるまで 1 回 50 件抽出して継続

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/test/media-backfill.integration.test.ts`(既存 backfill テストの起動/待機パターンに従う — `wait-for-backfill.ts` を読むこと):

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { PNG_1x1 } from './fixtures/images';
import { objectIndexStub } from './object-index-namespace';
import { waitForBackfill } from './wait-for-backfill';

describe('media 追い掛けフェーズ', () => {
  it('バックフィルで拾った既存画像の寸法が追い掛けで埋まる', async () => {
    // R2 に直接 put(= 索引を経由しない既存オブジェクト)
    await env.BUCKET_PHOTOS.put('chase/a.png', PNG_1x1);
    await env.BUCKET_PHOTOS.put('chase/b.txt', 'not an image');

    const stub = objectIndexStub('photos-chase-1');
    await stub.startBackfill('photos');
    await waitForBackfill(stub); // media フェーズ完了まで待つ形に拡張する(下記)

    const page = await stub.list({ bucketId: 'photos', prefix: 'chase/', cursor: undefined, limit: 10 });
    const a = page.objects.find((o) => o.key === 'chase/a.png');
    const b = page.objects.find((o) => o.key === 'chase/b.txt');
    expect(a?.media).toEqual({ kind: 'image', width: 1, height: 1 });
    expect(b?.media).toEqual({ kind: 'none' });
  });

  it('status が media 残件数を報告する', async () => {
    // 起動直後(索引フェーズ complete 直後)に mediaPending > 0 を観測するのは
    // alarm 自動発火とレースするため、最終状態のみ固定する:
    const stub = objectIndexStub('photos-chase-1');
    const status = await stub.status();
    expect(status).toEqual({ kind: 'complete', indexed: expect.any(Number), mediaPending: 0 });
  });
});
```

`waitForBackfill` が索引フェーズの complete だけを見ているなら、mediaPending === 0 まで待つよう拡張する(既存利用箇所の互換を保つこと)。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @r2-drive/api test -- media-backfill`
Expected: FAIL(mediaPending が無い / 寸法が埋まらない)

- [ ] **Step 3: 実装する**

`status.ts`: `complete` variant を `{ kind: 'complete'; indexed: number; mediaPending: number }` に変更(他 variant は不変。ワイヤ互換: status の消費者は運用用エンドポイントのみ — `apps/web` が触っていないことを grep で確認し report に記す)。

`object-index/index.ts`:
- 定数 `const MEDIA_CHASE_BATCH = 50;`
- `#mediaPendingCount(): number` — `SELECT count(*) FROM objects WHERE width IS NULL AND content_type LIKE 'image/%'`(drizzle の `isNull` + `like`)
- `#indexPage` の complete 分岐: `BACKFILL_STATE_KEY = 'complete'` を書いた**後**、`#mediaPendingCount() > 0` なら `await this.ctx.storage.setAlarm(Date.now())` で追い掛けを予約
- `alarm()` の先頭ガードを拡張: state が `'running'` なら従来の索引フェーズ、`'complete'` かつ mediaPending > 0 なら media フェーズ(`#chaseMediaFacts(bucketId, bucket)`)、それ以外は return
- `#chaseMediaFacts`:

```ts
// 索引フェーズ complete 後の追い掛け。width IS NULL の画像行を 1 alarm あたり
// MEDIA_CHASE_BATCH 件だけ抽出する。カーソルは持たない — width IS NULL が残作業
// そのものであり、抽出済み行は自然に候補から消える。行が途中で削除されても
// setMediaFacts は 0 行更新で終わる(Task 2)。抽出失敗(undefined)の行は
// ここで width=0/height=0 を書いて「試行済み・寸法なし」を刻み、無限ループを防ぐ
// (mediaOf は 0 以下を none に写すので、ワイヤ上は none のまま — Task 1 の仕様)。
async #chaseMediaFacts(bucketId: string, bucket: R2Bucket): Promise<void> {
  const rows = this.db
    .select({ key: objects.key })
    .from(objects)
    .where(and(isNull(objects.width), like(objects.contentType, 'image/%')))
    .orderBy(asc(objects.key))
    .limit(MEDIA_CHASE_BATCH)
    .all();

  for (const row of rows) {
    await probeImageDimensions(bucket, row.key).match(
      (dimensions) => this.setMediaFacts(row.key, dimensions?.width ?? 0, dimensions?.height ?? 0),
      (error) => console.error(`media chase failed: ${row.key}`, error),
    );
  }

  if (this.#mediaPendingCount() > 0) await this.ctx.storage.setAlarm(Date.now());
}
```

**注意**: `setMediaFacts(key, 0, 0)` を「試行済み」の刻印に使うため、Task 2 の `setMediaFacts` は 0 を拒否しない(拒否ガードは `mediaOf` のワイヤ境界にある)。R2 読み取り自体が失敗(err)した行は width NULL のまま残る → 次の alarm で再試行され、失敗が続く限りループしうる — `console.error` の後、その行にも 0/0 を刻んで前進を保証する(エラー分岐でも `this.setMediaFacts(row.key, 0, 0)` を呼ぶ)。
- `status()` の complete 分岐に `mediaPending: this.#mediaPendingCount()` を追加
- **既存テストの追随**: `complete` の形状を `toEqual` で張っている既存テスト
  (backfill 系・index/status 系)に `mediaPending` を追加する。件数は文脈依存なので
  安易に `expect.any(Number)` へ逃げず、そのテストのデータで確定する値を書く

- [ ] **Step 4: PASS + 全体確認 + Commit**

```bash
pnpm --filter @r2-drive/api test -- media-backfill && pnpm test && pnpm lint && pnpm typecheck
git add packages/api/
git commit -m "feat(api): バックフィル完了後に既存画像の寸法を追い掛け抽出する"
```

---

### Task 6: skyline `pack` / `computeBlanks` の移植

**Files:**
- Create: `apps/web/src/routes/-components/gallery/skyline/pack.ts`
- Create: `apps/web/src/routes/-components/gallery/skyline/pack.test.ts`
- Create: `apps/web/src/routes/-components/gallery/skyline/compute-blanks.ts`
- Create: `apps/web/src/routes/-components/gallery/skyline/compute-blanks.test.ts`

**Interfaces:**
- Produces: `pack(items: readonly PackItem[], columns: number): PackResult`、`PackItem = { id: string; ratio: number; span: number }`、`Placement = { id; col; span; y; height }`(cw 単位)、`computeBlanks(placements, columns, totalHeight): Blank[]`。Task 7 が消費

- [ ] **Step 1: 参照実装をテストごと移植する**

`~/ghq/github.com/napolab/www.napochaan.com/src/components/gallery-archive/skyline/` から `pack.ts` / `pack.test.ts` / `compute-blanks.ts` / `compute-blanks.test.ts` を**そのまま**コピーする(コメント込み。import パスだけ調整)。`layout.ts`(`spanForAspect`)は移植**しない** — 本計画は全アイテム span=1(spec §9)であり、使わないコードを持ち込まない。ファイル冒頭に出典コメントを 1 行足す:

```ts
// 出典: napolab/www.napochaan.com src/components/gallery-archive/skyline/pack.ts(2026-08-21 時点)
```

移植コードがこのリポジトリの lint ルール(`let` 禁止等)に触れる場合のみ最小修正し、テストが同一のまま通ることを保証する。

- [ ] **Step 2: テストが通ることを確認 + Commit**

```bash
pnpm --filter web exec vitest run src/routes/-components/gallery --config vitest.config.ts
pnpm lint && pnpm typecheck
git add apps/web/src/routes/-components/gallery/
git commit -m "feat(web): 参照実装から skyline pack / computeBlanks をテストごと移植する"
```

---

### Task 7: `SkylineLayout`(react-aria custom Layout)

**Files:**
- Create: `apps/web/src/routes/-components/gallery/skyline-layout/index.ts`
- Create: `apps/web/src/routes/-components/gallery/skyline-layout/skyline-layout.test.ts`

**Interfaces:**
- Consumes: Task 6 の `pack` / `PackItem`
- Produces: `class SkylineLayout extends Layout`(react-aria-components から import できなければ `@react-stately/virtualizer`)。`layoutOptions: { ratioOf: (key: Key) => number }` 相当でコレクションの各アイテムの ratio を引けるようにする。Task 8 が `<Virtualizer layout={SkylineLayout} layoutOptions={...}>` で消費

- [ ] **Step 1: installed の Layout API を確認する**

実装前に、installed パッケージの型定義を読む(named check):`Layout` / `LayoutInfo` / `Rect` / `Size` が `react-aria-components` から re-export されているか、無ければ `@react-stately/virtualizer` を直接依存に足すか(pnpm add)を判定し、abstract メソッドの正確なシグネチャ(`update(invalidationContext)`, `getLayoutInfo(key)`, `getVisibleLayoutInfos(rect)`, `getContentSize()`, `shouldInvalidateLayoutOptions` など)を確認する。差分があれば下記実装を最小適合させ、report に記録する。

- [ ] **Step 2: 失敗するテストを書く**

`skyline-layout.test.ts`(Layout を直接インスタンス化して幾何を検証。Virtualizer 実物は使わない — Task 8 の結合で担保):

**テスト対象を純関数に寄せる**: Layout クラスの react-aria 結合部は薄く保ち、幾何計算を
`computeSkylineGeometry` として同ディレクトリに切り出し、テストはこれを直接検証する:

```ts
import { describe, expect, it } from 'vitest';

import { computeSkylineGeometry, visibleRectIds } from './geometry';

// pack 自体の正しさは pack.test.ts が持つ。ここは「cw 単位 → px」の写像だけを固定する。
// 2 列・cw=100。pack の挙動(leftmost-lowest): a(ratio1)→col0 y0 h1、b(ratio2)→col1 y0 h2、
// c(ratio0.5)→col0 y1 h0.5。totalHeight=2。
const items = [
  { id: 'a', ratio: 1, span: 1 },
  { id: 'b', ratio: 2, span: 1 },
  { id: 'c', ratio: 0.5, span: 1 },
];

describe('computeSkylineGeometry', () => {
  it('placements を px 座標に写し、コンテンツ高さは最大列', () => {
    const { rects, totalHeight } = computeSkylineGeometry(items, 2, 100);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(rects.get('b')).toEqual({ x: 100, y: 0, width: 100, height: 200 });
    expect(rects.get('c')).toEqual({ x: 0, y: 100, width: 100, height: 50 });
    expect(totalHeight).toBe(200);
  });

  it('可視 rect と交差する id だけが返る', () => {
    const { rects } = computeSkylineGeometry(items, 2, 100);
    // y=120〜220 の窓: a(0-100)は外、b(0-200)と c(100-150)は交差
    expect(visibleRectIds(rects, { x: 0, y: 120, width: 200, height: 100 }).sort()).toEqual(['b', 'c']);
  });
});
```

`geometry.ts` の公開シグネチャ:

```ts
export type PxRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export const computeSkylineGeometry: (items: readonly PackItem[], columns: number, cw: number) => { rects: ReadonlyMap<string, PxRect>; totalHeight: number };
export const visibleRectIds: (rects: ReadonlyMap<string, PxRect>, view: PxRect) => string[]; // 線形フィルタ(spec §6.3 の判断)
```

load-more センチネルの配置(totalHeight 直下)は Layout クラス側の責務なので、Task 10 のブラウザ検証で担保する(jsdom で Virtualizer 実物を回さない)。

- [ ] **Step 3: 実装する**

`computeSkylineGeometry`(純関数)+ `SkylineLayout`(Layout サブクラス)。Layout 側の責務:
- `update()`: `this.virtualizer.collection` からアイテム列挙(loader/センチネル項目は type で分岐)、`ratioOf(key)` で PackItem を作り、`columns = clamp(floor(width / MIN_COLUMN_PX), 2, 4)`(`MIN_COLUMN_PX = 240`)、`cw = width / columns`、`computeSkylineGeometry` の結果をキャッシュ
- `getContentSize()`: `new Size(width, totalHeight [+ センチネル高さ])`
- `getLayoutInfo(key)`: キャッシュから `new LayoutInfo('item', key, new Rect(x, y, w, h))`
- `getVisibleLayoutInfos(rect)`: `visibleRectIds`(線形。spec §6.3 の判断どおり、基準 4 の実測で二分探索を再検討)
- `shouldInvalidateLayoutOptions` / invalidation: ratioOf・コンテナ幅変更で再計算
- キーボードナビゲーション: まず Layout 既定の delegate(LayoutInfo の矩形ベース)に任せ、
  ↑↓←→ の実挙動は Task 10 のブラウザ検証で確認する。skyline で「真下」が不自然なら
  spec §6.3 の方針(列の重なり最大を次候補)で `getKeyBelow` 相当を上書きする —
  ただしそれは検証で問題が出てからで良い(YAGNI)

- [ ] **Step 4: PASS + Commit**

```bash
pnpm --filter web exec vitest run src/routes/-components/gallery --config vitest.config.ts && pnpm lint && pnpm typecheck
git add apps/web/src/routes/-components/gallery/
git commit -m "feat(web): skyline pack を react-aria custom Layout に写す SkylineLayout を実装する"
```

---

### Task 8: `GalleryView` コンポーネント(チップ列 + skyline GridList)

**Files:**
- Create: `apps/web/src/routes/-components/gallery/index.tsx`
- Create: `apps/web/src/routes/-components/gallery/styles.css.ts`
- Create: `apps/web/src/routes/-components/gallery/gallery.test.tsx`

**Interfaces:**
- Consumes: Task 7 の `SkylineLayout`、既存 `resolveFileType`(image 判定)、`getContentUrl`、`findAdjacentViewable` は不要(ビューアは `?view=` 経由)
- Produces:
  ```ts
  // Props は ObjectList と対称に(route から同じデータを受ける)
  type Props = {
    readonly folders: readonly FolderDescriptor[];
    readonly objects: readonly ObjectDescriptor[];
    readonly getContentUrl: (object: ObjectDescriptor) => string;
    readonly selectedKeys: Selection;
    readonly onSelectionChange: (keys: Selection) => void;
    readonly onOpenFolder: (prefix: string) => void;
    readonly onOpenObject: (key: string) => void;
    readonly onLoadMore: () => void;
    readonly isLoadingMore: boolean;
  };
  export const GalleryView: (props: Props) => JSX.Element;
  export const isGalleryImage: (object: ObjectDescriptor) => boolean; // contentType image/* 判定(route の自動フォールバックが再利用)
  ```

- [ ] **Step 1: 失敗するテストを書く**

`gallery.test.tsx`(jsdom。Virtualizer の geometry は jsdom で 0 になりがち — vitest.setup.ts の既存パッチと object-list.test.tsx の流儀を確認し、同じ手法を使う):

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { GalleryView, isGalleryImage } from './index';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string, media: ObjectDescriptor['media'] = { kind: 'none' }): ObjectDescriptor => ({ bucketId: 'b', key, name: key, contentType, size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"', media });
const folder = (prefix: string): FolderDescriptor => ({ bucketId: 'b', prefix, name: prefix.slice(0, -1) });

const renderGallery = (overrides: Partial<Parameters<typeof GalleryView>[0]> = {}) => {
  const onOpenFolder = vi.fn();
  const onOpenObject = vi.fn();
  render(
    <GalleryView
      folders={[folder('trips/')]}
      objects={[make('a.png', 'image/png', { kind: 'image', width: 800, height: 600 }), make('b.png', 'image/png'), make('notes.md', 'text/markdown')]}
      getContentUrl={(o) => `/content/${o.key}`}
      selectedKeys={new Set()}
      onSelectionChange={() => undefined}
      onOpenFolder={onOpenFolder}
      onOpenObject={onOpenObject}
      onLoadMore={() => undefined}
      isLoadingMore={false}
      {...overrides}
    />,
  );
  return { onOpenFolder, onOpenObject };
};

afterEach(cleanup);

describe('GalleryView', () => {
  it('フォルダと非画像はチップ列、画像はチップに出ない', () => {
    renderGallery();
    expect(screen.getByRole('button', { name: /trips/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /notes\.md/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /a\.png/ })).toBeNull();
  });

  it('フォルダチップで onOpenFolder が呼ばれる', async () => {
    const { onOpenFolder } = renderGallery();
    await userEvent.click(screen.getByRole('button', { name: /trips/ }));
    expect(onOpenFolder).toHaveBeenCalledWith('trips/');
  });

  it('view 可能な非画像チップで onOpenObject が呼ばれる', async () => {
    const { onOpenObject } = renderGallery();
    await userEvent.click(screen.getByRole('button', { name: /notes\.md/ }));
    expect(onOpenObject).toHaveBeenCalledWith('notes.md');
  });
});

describe('isGalleryImage', () => {
  it('contentType image/* のみ true', () => {
    expect(isGalleryImage(make('a.png', 'image/png'))).toBe(true);
    expect(isGalleryImage(make('a.md', 'text/markdown'))).toBe(false);
    expect(isGalleryImage(make('v.mp4', 'video/mp4'))).toBe(false);
  });
});
```

画像セル側(skyline 内の描画・onAction・media none の正方形)は Virtualizer が jsdom で行を描画しない場合、Phase 2 の前例(object-list.test.tsx)どおりセル単位コンポーネントを直接 render する形に落として良い — その場合もセルの onAction → onOpenObject と、media none で描画が成立することの 2 assert は必ず張る。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter web exec vitest run src/routes/-components/gallery --config vitest.config.ts`
Expected: FAIL(GalleryView 未実装)

- [ ] **Step 3: 実装する**

`index.tsx` の構造:

```tsx
export const isGalleryImage = (object: ObjectDescriptor): boolean => object.contentType.startsWith('image/');

export const GalleryView = ({ folders, objects, getContentUrl, selectedKeys, onSelectionChange, onOpenFolder, onOpenObject, onLoadMore, isLoadingMore }: Props) => {
  const images = useMemo(() => objects.filter(isGalleryImage), [objects]);
  const others = useMemo(() => objects.filter((o) => !isGalleryImage(o)), [objects]);
  const ratioOf = useCallback(
    (key: Key) => {
      const object = images.find((o) => o.key === key); // 実装では Map 化する
      return object !== undefined && object.media.kind === 'image' ? object.media.height / object.media.width : 1;
    },
    [images],
  );
  // チップ列(Virtualizer の外) + Virtualizer(layout={SkylineLayout} layoutOptions={{ ratioOf }})
  //   + GridList(selectionMode="multiple") + GridListItem(画像セル、onAction → onOpenObject)
  //   + GridListLoadMoreItem(onLoadMore / isLoadingMore)
};
```

- チップ: フォルダは `onAction → onOpenFolder`、非画像は capability が view なら `onAction → onOpenObject`、opaque は onAction なし(Phase 2 の FileRow と同じ conditional spread)。react-aria の `Button` or `GridList` 外の Link 相当 — チップは選択対象外なので通常の `Button` で良い(role 上はボタン列)
- 画像セル: `<img src={getContentUrl(object)} alt="" loading="lazy" decoding="async" draggable={false}>`、`object-fit: cover`(none 画像の正方形)/ `contain` ではなく **cover**(セルの幾何が ratio 通りなので image ratio 既知なら cover でも欠けない。none の正方形セルでは cover でトリミングされる — それが spec §7 の意図)
- 読み込み失敗は Phase 2 の Preview と同じ onError → アイコン + ファイル名 fallback(幾何は変えない)
- チップ列の畳み: `COLLAPSED_CHIP_COUNT = 20` 超は「他 N 件」ボタンで展開(state は variant `{ kind: 'collapsed' } | { kind: 'expanded' }`)
- styles.css.ts: チップ列(flex wrap, gap inline, mono フォント名)、セル(border hairline)。design-direction のトークンのみ

- [ ] **Step 4: PASS + 全体確認 + Commit**

```bash
pnpm --filter web exec vitest run src/routes/-components/gallery --config vitest.config.ts && pnpm test && pnpm lint && pnpm typecheck
git add apps/web/src/routes/-components/gallery/
git commit -m "feat(web): チップ列 + skyline の GalleryView を実装する"
```

---

### Task 9: route 配線(既定ギャラリー・`?mode=tiles`・自動フォールバック)

**Files:**
- Modify: `apps/web/src/routes/b.$bucketId.$.tsx`(mode search param、GalleryView / BucketObjectActions の出し分け、トグル)
- Modify: `apps/web/src/routes/b.$bucketId.$.styles.css.ts`(トグルの styles)
- Test: 既存 route 系テストへの追記 or `-components/gallery/gallery.test.tsx` に統合ケース追加

**Interfaces:**
- Consumes: Task 8 の `GalleryView` / `isGalleryImage`、Phase 2 の `viewerSearchSchema` パターン
- Produces: `?mode=tiles` で従来表示、無指定はギャラリー(画像 0 件は自動でタイル)。`?view=` と共存

- [ ] **Step 1: 失敗するテストを書く**

表示モード解決を純関数に切り出してテストする:

```ts
// apps/web/src/routes/-components/gallery/resolve-view-mode.ts
export type ViewMode = 'gallery' | 'tiles';
export const resolveViewMode = (requested: 'tiles' | undefined, hasImages: boolean): ViewMode => (requested === 'tiles' || !hasImages ? 'tiles' : 'gallery');
```

```ts
// resolve-view-mode.test.ts
it('無指定 + 画像ありはギャラリー', () => expect(resolveViewMode(undefined, true)).toBe('gallery'));
it('?mode=tiles は常にタイル', () => expect(resolveViewMode('tiles', true)).toBe('tiles'));
it('画像 0 件は自動でタイル', () => expect(resolveViewMode(undefined, false)).toBe('tiles'));
```

- [ ] **Step 2: FAIL → 実装 → PASS**

- `viewerSearchSchema` を `z.object({ view: z.string().optional(), mode: z.enum(['tiles']).optional() })` に拡張(gallery は無指定で表す — URL に既定値を書かない)
- `BucketWorkspace`: `resolveViewMode(mode, objects.some(isGalleryImage))` で分岐し、`GalleryView` か既存 `BucketObjectActions` を描画。**選択状態・ビューア(`?view=`)・アップロードセッションは両モードで共有**(props の受け渡しを対称に)。ギャラリー時も削除等の一括アクションはヘッダ側の既存導線が生きること(BucketObjectActions の構造を確認し、必要なら「一覧部分だけ」を差し替えられる形に最小リファクタ — 大きくなるなら DONE_WITH_CONCERNS で報告)
- トグル: ヘッダに `react-aria` の `ToggleButtonGroup`(なければ 2 つの `ToggleButton` / リンク)。gallery 選択で `mode` を search から外し、tiles 選択で `mode: 'tiles'` を付ける(navigate、replace: false)
- 手動確認は Task 10 に委ねる

- [ ] **Step 3: 全体確認 + Commit**

```bash
pnpm test && pnpm lint && pnpm typecheck
git add apps/web/src/routes/
git commit -m "feat(web): バケットの既定ビューを skyline ギャラリーにする(?mode=tiles で従来表示)"
```

---

### Task 10: 受け入れ基準の検証

**Files:** なし(検証のみ。修正が出たら該当タスクへ)

- [ ] **Step 1: 全スイート**

`pnpm test && pnpm lint && pnpm typecheck` — 全グリーンを記録。

- [ ] **Step 2: dev server + ブラウザで spec §10 の基準 1-9 を通す**

seed(画像多数 + フォルダ + 非画像 + 大量件数)を投入し、playwright MCP で:
1. 既定ギャラリー表示・シフトなし(スクリーンショット + layout shift 監視)
2. `?mode=tiles` 切替で従来一覧、選択・削除・ビューアが動く
3. ギャラリーの画像クリック → `?view=` ビューア、←/→、バック 1 回クローズ
4. 10,000 件スクロールのフレーム(DOM ノード数が可視分に留まることを確認)
5. アップロード → リロード → 正しい縦横比
6. バックフィル(POST /index/backfill)→ status の mediaPending が 0 に → 縦横比反映
7. 画像 0 件フォルダの自動タイル
8. チップ列からフォルダ潜り / 非画像ビューア
9. `indexed: false`(media バケット)でも全 ratio=1 でギャラリーが開く

- [ ] **Step 3: レポート + difit**

検証結果をレポートにまとめ、`npx difit HEAD main` でレビュー依頼。
