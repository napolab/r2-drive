# Phase 2 ビューア群 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一覧からファイルを開ける overlay ビューア(画像 / 動画 / 音楽 / markdown / テキスト)を search param `?view=<key>` ベースで実装する。

**Architecture:** 既存 `FileTypePlugin` に `capability`(`opaque` | `view`)を追加し、各プラグインが lazy な Viewer を宣言する。overlay は react-aria の `Modal`+`Dialog` で、状態の実体は URL の `?view=` のみ。サーバ追加は単一オブジェクト取得 API 1 本だけ(Range 配信は Phase 0 実装済み)。

**Tech Stack:** react-aria-components(既存)/ shiki v4(`createHighlighterCore` + `createCssVariablesTheme`)/ react-markdown v10 + remark-gfm / TanStack Query(既存)

**Spec:** `docs/superpowers/specs/2026-08-20-r2-drive-phase-2-design.md`(親: `2026-08-14-r2-drive-design.md` §5.3)

## Global Constraints

- 作業ブランチ: `feat/phase-2-viewers`。着手前に `git fetch origin main && git pull --ff-only origin main` してから `git switch -c feat/phase-2-viewers`(.claude/rules/git-workflow.md)
- 各タスク完了時に `pnpm lint && pnpm typecheck` を必ず通す。`npx tsc` 禁止
- top-level 関数はアロー関数のみ。`let` / `forEach` / IIFE / non-null `!` / `any` 禁止(.claude/rules/functional-programming.md, function-style.md)
- **optional field を作らない。**「あるときだけある」は variant で表す(CLAUDE.md coding rules)
- ディスパッチは `createRunner`(packages/core)を共有。新しいディスパッチ形を発明しない
- registry は明示配列。順序に意味がある(specific → broad)
- Panda CSS は strictTokens。任意値は `'[...]'` エスケープでのみ書ける。スタイルは colocated `styles.css.ts` に置く(.claude/skills/file-colocation)
- コンポーネントディレクトリは `index.tsx` + `styles.css.ts` + `<name>.test.tsx` の 3 ファイル(plugin ディレクトリは例外)
- 数値・識別子(サイズ・日時・パス)は `fontFamily: 'mono'` + `fontVariantNumeric: 'tabular-nums'`(.claude/rules/design-direction.md)
- テスト: apps/web は jsdom(`pnpm --filter web test` = vitest projects の web)、packages/api は `@cloudflare/vitest-pool-workers`(実 R2)
- commit メッセージ末尾: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `code.*` semantic token の移植と AA 検証

**Files:**
- Modify: `apps/web/src/themes/tokens/index.ts`(semanticTokens.colors に `code` グループを追加)
- Modify: `apps/web/src/themes/tokens/tokens.test.ts`(AA テスト追加)

**Interfaces:**
- Consumes: 既存の `semanticTokens` / `contrastRatio` / テストヘルパ `val` / `sem` / `resolve`
- Produces: Panda semantic token `colors.code.{bg,fg,comment,keyword,string,number,function,punctuation}`。Task 9 の CodeBlock styles が `token(colors.code.*)` で参照する

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/themes/tokens/tokens.test.ts` の末尾に追加。`sem` と `resolve` は同ファイルの既存ヘルパをそのまま使う(`resolve` は `{colors.gray.3}` 形式の参照を raw 値に解決する。リテラル oklch はそのまま通ることを既存実装で確認し、通らなければリテラルをそのまま返す分岐を `resolve` に足す):

```ts
describe('code tokens WCAG AA (on code.bg = gray.3)', () => {
  const codeBg = val('gray', 3);
  const textKeys = ['fg', 'comment', 'keyword', 'string', 'number', 'function', 'punctuation'] as const;

  it('code.bg is gray.3 (= bg.muted)', () => {
    expect(resolve(sem('code.bg'))).toBe(codeBg);
  });

  for (const key of textKeys) {
    it(`code.${key} on code.bg >= 4.5`, () => {
      expect(contrastRatio(resolve(sem(`code.${key}`)), codeBg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/themes/tokens --config vitest.config.ts`
Expected: FAIL(`code` グループが存在しない)

- [ ] **Step 3: token を追加する**

`apps/web/src/themes/tokens/index.ts` の `semanticTokens.colors` の `danger` の直後に追加。値は `www.napochaan.com` の `src/themes/tokens/index.ts` からの移植(コントラスト注記ごと)。teal / amber の hue は ramp(gray/blue/red の 3 本)には足さず、semantic 層のリテラルとして持つ:

```ts
    // syntax highlight 用。www.napochaan.com から移植(注記の比率は gray.3 上での実測)。
    // teal(195)/ amber(55)は ramp に昇格させない。ramp は 3 本のみ(design-direction)。
    code: {
      bg: { value: '{colors.gray.3}' }, // = bg.muted
      fg: { value: 'oklch(0.260 0.020 265)' }, // 12.2:1 on gray.3
      comment: { value: 'oklch(0.510 0.017 265)' }, // 4.53:1
      keyword: { value: 'oklch(0.490 0.287 266)' }, // 5.53:1  electric blue (= blue.9)
      string: { value: 'oklch(0.470 0.110 195)' }, // 4.83:1  teal
      number: { value: 'oklch(0.500 0.130 55)' }, // 4.94:1  amber
      function: { value: 'oklch(0.430 0.230 266)' }, // 6.90:1  deep blue
      punctuation: { value: 'oklch(0.430 0.018 265)' }, // 6.35:1  grey (= gray.11)
    },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/themes/tokens --config vitest.config.ts`
Expected: PASS(既存の ramp テスト「only blue, red, gray ramps exist」も壊れていないこと)

- [ ] **Step 5: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/themes/tokens/
git commit -m "feat(web): syntax highlight 用の code.* semantic token を AA 検証付きで移植する"
```

---

### Task 2: 単一オブジェクト取得 API(deep link 用)

**Files:**
- Create: `packages/api/src/r2/head.ts`
- Modify: `packages/api/src/buckets/index.ts`(`.delete('/:bucketId/objects/:path{.+}')` の直前に GET を追加)
- Test: `packages/api/test/head-object.integration.test.ts`

**Interfaces:**
- Consumes: `resolveBucket`(`../r2/registry`)、`keyPartsOf`(`../object-index/key-parts/index`)、`contentTypeOf`(`./list`)、`toErrorResponse`
- Produces: `GET /api/buckets/:bucketId/objects/:path{.+}` → 200 で `ObjectDescriptor`、404 で `ObjectNotFoundError` の wire。Hono RPC 経由で `client.buckets[':bucketId'].objects[':path{.+}'].$get(...)` が型付きで使える(Task 7 が消費)

- [ ] **Step 1: 失敗する integration test を書く**

`packages/api/test/head-object.integration.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

import type { ObjectDescriptor } from '@r2-drive/core';

describe('GET /buckets/:bucketId/objects/:path{.+}(単一オブジェクト取得)', () => {
  beforeEach(async () => {
    await env.BUCKET_MEDIA.put('docs/note.md', '# hi');
  });

  it('ObjectDescriptor を 1 件返す', async () => {
    const res = await api.request('/buckets/media/objects/docs/note.md', {}, env);
    expect(res.status).toBe(200);
    const descriptor = (await res.json()) as ObjectDescriptor;

    expect(descriptor.bucketId).toBe('media');
    expect(descriptor.key).toBe('docs/note.md');
    expect(descriptor.name).toBe('note.md');
    expect(descriptor.contentType).toBe('text/markdown');
    expect(descriptor.size).toBe(4);
    expect(descriptor.etag).toMatch(/^"/); // httpEtag は引用符付き
  });

  it('存在しない key は 404', async () => {
    const res = await api.request('/buckets/media/objects/missing.txt', {}, env);
    expect(res.status).toBe(404);
  });

  it('一覧ルート(splat なし)を隠さない', async () => {
    const res = await api.request('/buckets/media/objects', {}, env);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @r2-drive/api test -- head-object`
Expected: FAIL(404 が返る = ルート未定義)

- [ ] **Step 3: `headObject` を実装する**

`packages/api/src/r2/head.ts`。descriptor の導出は `list.ts` と同じ関数を通す(Ruling 16: `contentTypeOf` / `keyPartsOf` の共有。2 経路が乖離しないため):

```ts
import { ObjectNotFoundError, R2OperationError } from '@r2-drive/core';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import { keyPartsOf } from '../object-index/key-parts/index';
import { contentTypeOf } from './list';

import type { DriveError, ObjectDescriptor } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

export const headObject = (bucket: R2Bucket, bucketId: string, key: string): ResultAsync<ObjectDescriptor, DriveError> =>
  fromPromise(bucket.head(key), (cause) => new R2OperationError(`head failed: ${key}`, { cause })).andThen((head) =>
    head === null
      ? errAsync(new ObjectNotFoundError(key))
      : okAsync({
          bucketId,
          key,
          name: keyPartsOf(key).name,
          contentType: contentTypeOf(key),
          size: head.size,
          uploadedAt: head.uploaded.toISOString(),
          etag: head.httpEtag,
        }),
  );
```

- [ ] **Step 4: ルートを追加する**

`packages/api/src/buckets/index.ts` の `.delete('/:bucketId/objects/:path{.+}', ...)` の**直前**に追加(delete と同じ `.match` パターン)。import に `headObject` を足す:

```ts
  // deep link(?view=<key>)でビューアを直接開いたときの descriptor 解決用。
  // 2 番目のセグメントが 'objects' + splat。'/:bucketId/objects'(完全一致)とは衝突しない。
  .get('/:bucketId/objects/:path{.+}', async (c) => {
    const key = c.req.param('path');
    const bucketId = c.req.param('bucketId');

    return resolveBucket(c.env, bucketId).match(
      async (bucket) =>
        headObject(bucket, bucketId, key).match(
          (descriptor) => c.json(descriptor, 200),
          (error) => toErrorResponse(c, error),
        ),
      async (error) => toErrorResponse(c, error),
    );
  })
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @r2-drive/api test -- head-object`
Expected: PASS(3 件)

- [ ] **Step 6: 全体を回して commit**

```bash
pnpm test && pnpm lint && pnpm typecheck
git add packages/api/src/r2/head.ts packages/api/src/buckets/index.ts packages/api/test/head-object.integration.test.ts
git commit -m "feat(api): deep link 用の単一オブジェクト取得 API を追加する"
```

---

### Task 3: `FileTypeCapability` の導入と ImageViewer

**Files:**
- Modify: `apps/web/src/plugins/file-type/types.ts`(`ViewerProps` / `LazyViewer` / `FileTypeCapability` を追加、`FileTypeMatch` に `capability` フィールド追加)
- Create: `apps/web/src/plugins/file-type/image/viewer.tsx`
- Modify: `apps/web/src/plugins/file-type/image/index.tsx`(capability: view)
- Modify: `apps/web/src/plugins/file-type/image/styles.css.ts`(viewer スタイル追加)
- Modify: `apps/web/src/plugins/file-type/{video,audio,markdown,opaque}/index.tsx`(暫定 `capability: { kind: 'opaque' }`。video/audio は Task 5、markdown は Task 10 で view に昇格)
- Test: `apps/web/src/plugins/file-type/image/image.test.tsx`(既存に追記)、`apps/web/src/plugins/file-type/opaque/opaque.test.tsx`(既存に追記)

**Interfaces:**
- Consumes: `ObjectDescriptor`、既存 `FileTypeMatch` / `PreviewProps`
- Produces: `FileTypeCapability = { kind: 'opaque' } | { kind: 'view'; Viewer: LazyViewer }`、`ViewerProps = { object; getContentUrl }`。Task 5/7/8/10/11 が消費。viewer ファイルは **default export**(`lazy()` の要件)

- [ ] **Step 1: 失敗するテストを書く**

`image.test.tsx` に追記(既存のテストスタイルに合わせる。プラグインの `run()` を直接呼ぶ):

```tsx
it('image は view capability を持つ', () => {
  const result = imagePlugin.run({ bucketId: 'b', key: 'a.png', name: 'a.png', contentType: 'image/png', size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });
  expect(result.isOk() && result.value.capability.kind).toBe('view');
});
```

`opaque.test.tsx` に追記:

```tsx
it('opaque は opaque capability を持つ', () => {
  const result = opaquePlugin.run({ bucketId: 'b', key: 'a.bin', name: 'a.bin', contentType: 'application/octet-stream', size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });
  expect(result.isOk() && result.value.capability.kind).toBe('opaque');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/plugins/file-type --config vitest.config.ts`
Expected: FAIL(`capability` プロパティが存在しない — 型エラーで落ちる場合も「失敗」として扱う)

- [ ] **Step 3: 型を拡張する**

`types.ts` に追加(`FileTypeMatch` の Preview コメントの下)。`ComponentType` の import に `LazyExoticComponent` を足す:

```ts
export type ViewerProps = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

export type LazyViewer = LazyExoticComponent<ComponentType<ViewerProps>>;

// 「表示だけ」「解釈しない」は 2 つの状態。Editor? という optional は作らない。
// Phase 3 で { kind: 'view-and-edit'; Viewer; Editor } を足すと、capability を
// switch している全消費側がコンパイルエラーになる — それが意図した拡張手順である。
export type FileTypeCapability = { readonly kind: 'opaque' } | { readonly kind: 'view'; readonly Viewer: LazyViewer };

export type FileTypeMatch = {
  readonly typeId: string;
  readonly label: string;
  readonly Icon: ComponentType<IconProps>;
  readonly Preview: ComponentType<PreviewProps>;
  readonly capability: FileTypeCapability;
};
```

- [ ] **Step 4: ImageViewer を実装する**

`image/viewer.tsx`(default export。`lazy()` が要求する):

```tsx
import { useCallback, useState } from 'react';
import { Link } from 'react-aria-components';

import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const ImageViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);

  if (hasLoadError) {
    return (
      <div className={styles.viewerErrorRoot} role="alert">
        <p>画像を読み込めませんでした</p>
        <Link href={getContentUrl(object)} download={object.name}>
          ダウンロード
        </Link>
      </div>
    );
  }

  return <img className={styles.viewerImage} src={getContentUrl(object)} alt={object.name} onError={handleError} />;
};

export default ImageViewer;
```

`image/styles.css.ts` に追加:

```ts
export const viewerImage = css({
  maxW: '[100%]',
  maxH: '[100%]',
  objectFit: 'contain',
  m: 'auto',
});

export const viewerErrorRoot = css({
  display: 'grid',
  gap: 'element',
  placeItems: 'center',
  p: 'block',
  color: 'fg.default',
});
```

- [ ] **Step 5: 全プラグインに capability を配線する**

`image/index.tsx`: ファイル先頭に `import { lazy } from 'react';` を足し、`ok({...})` に `capability: { kind: 'view', Viewer: ImageViewer }` を追加。`const ImageViewer = lazy(() => import('./viewer'));` をモジュールレベルに置く(**`run()` の中で `lazy()` を呼ばない** — 呼ぶたびに新しいコンポーネント型が生まれ、React がアンマウント→再マウントする)。

`video/index.tsx`, `audio/index.tsx`, `markdown/index.tsx`, `opaque/index.tsx`: それぞれの `ok({...})` に `capability: { kind: 'opaque' }` を追加。video/audio/markdown には `// TODO(Phase 2 Task 5/10): view に昇格` ではなく、コメント `// Task 5(video/audio)/ Task 10(markdown)で view に昇格する暫定値` を付ける。

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/plugins/file-type --config vitest.config.ts`
Expected: PASS(既存テスト含め全件)

- [ ] **Step 7: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/plugins/file-type/
git commit -m "feat(web): FileTypeCapability を導入し image に Viewer を実装する"
```

---

### Task 4: `PlaybackResolver` プラグイン

**Files:**
- Create: `apps/web/src/plugins/playback/types.ts`
- Create: `apps/web/src/plugins/playback/raw-range/index.ts`
- Create: `apps/web/src/plugins/playback/raw-range/raw-range.test.ts`
- Create: `apps/web/src/plugins/playback/registry.ts`

**Interfaces:**
- Consumes: `Processor` / `createRunner`(`@r2-drive/core`)
- Produces: `resolvePlayback(input: PlaybackResolverInput): Result<PlaybackSource, PlaybackResolverInput>`。`PlaybackSource = { kind: 'raw'; src: string }`。Task 5 の video/audio viewer が消費

- [ ] **Step 1: 失敗するテストを書く**

`raw-range/raw-range.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { rawRangeResolver } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const object: ObjectDescriptor = { bucketId: 'b', key: 'v.mp4', name: 'v.mp4', contentType: 'video/mp4', size: 10, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' };

describe('rawRangeResolver', () => {
  it('常に ok で content URL を返す', () => {
    const result = rawRangeResolver.run({ object, getContentUrl: (o) => `/content/${o.key}` });
    expect(result.isOk() && result.value).toEqual({ kind: 'raw', src: '/content/v.mp4' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/plugins/playback --config vitest.config.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装する**

`types.ts`:

```ts
import type { ObjectDescriptor, Processor } from '@r2-drive/core';

export type PlaybackResolverInput = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

export type PlaybackSource = { readonly kind: 'raw'; readonly src: string };
// Phase 6 で { kind: 'hls'; manifest: string } が加わる

export type PlaybackResolver = Processor<PlaybackResolverInput, PlaybackSource>;
```

`raw-range/index.ts`:

```ts
import { ok } from 'neverthrow';

import type { PlaybackResolver } from '../types';

// 常に ok を返す最終防衛線。Range 対応はサーバ(GET /content)が持つので、
// ここは content URL をそのまま返すだけでよい。
export const rawRangeResolver: PlaybackResolver = {
  id: 'raw-range',
  run: (input) => ok({ kind: 'raw', src: input.getContentUrl(input.object) }),
};
```

`registry.ts`:

```ts
import { createRunner } from '@r2-drive/core';

import { rawRangeResolver } from './raw-range/index';

import type { PlaybackResolver } from './types';

// 順序に意味がある(specific → broad)。Phase 6 の hlsResolver はこの配列の先頭に入る
// (トランスコード済みオブジェクトのみ ok を返し、それ以外は raw に落ちる)。
export const playbackResolvers = [rawRangeResolver] as const satisfies readonly PlaybackResolver[];

export const resolvePlayback = createRunner(playbackResolvers);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/plugins/playback --config vitest.config.ts`
Expected: PASS

- [ ] **Step 5: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/plugins/playback/
git commit -m "feat(web): PlaybackResolver 拡張点を raw-range 実装付きで導入する"
```

---

### Task 5: VideoViewer / AudioViewer

**Files:**
- Create: `apps/web/src/plugins/file-type/video/viewer.tsx`
- Create: `apps/web/src/plugins/file-type/video/styles.css.ts`
- Create: `apps/web/src/plugins/file-type/audio/viewer.tsx`
- Create: `apps/web/src/plugins/file-type/audio/styles.css.ts`
- Modify: `apps/web/src/plugins/file-type/video/index.tsx`、`audio/index.tsx`(capability を view に昇格)
- Test: `video/video.test.tsx`、`audio/audio.test.tsx`(既存に追記)

**Interfaces:**
- Consumes: `ViewerProps`(Task 3)、`resolvePlayback`(Task 4)
- Produces: video / audio プラグインの `capability.kind === 'view'`

- [ ] **Step 1: 失敗するテストを書く**

`video.test.tsx` に追記(audio も同型):

```tsx
it('video は view capability を持つ', () => {
  const result = videoPlugin.run({ bucketId: 'b', key: 'v.mp4', name: 'v.mp4', contentType: 'video/mp4', size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });
  expect(result.isOk() && result.value.capability.kind).toBe('view');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/plugins/file-type --config vitest.config.ts`
Expected: FAIL(現在は暫定 opaque)

- [ ] **Step 3: VideoViewer を実装する**

`video/viewer.tsx`(spec §8: メディア読み込み失敗は overlay 内のエラー状態 + ダウンロード導線に落とす):

```tsx
import { useCallback, useState } from 'react';
import { Link } from 'react-aria-components';

import { resolvePlayback } from '../../playback/registry';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const MediaLoadFailure = ({ object, getContentUrl, message }: ViewerProps & { readonly message: string }) => (
  <div className={styles.viewerErrorRoot} role="alert">
    <p>{message}</p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);

const VideoViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);

  if (hasLoadError) return <MediaLoadFailure object={object} getContentUrl={getContentUrl} message="動画を読み込めませんでした" />;

  return resolvePlayback({ object, getContentUrl }).match(
    (playback) => {
      switch (playback.kind) {
        case 'raw':
          // Range 再生・シーク・PiP・キーボード操作はブラウザ実装に任せる(ネイティブ controls)。
          return <video className={styles.viewerVideo} controls preload="metadata" src={playback.src} onError={handleError} />;
        default: {
          const _exhaustive: never = playback.kind;
          throw new Error(`unhandled playback: ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
    () => <MediaLoadFailure object={object} getContentUrl={getContentUrl} message="再生ソースを解決できませんでした" />,
  );
};

export default VideoViewer;
```

`video/styles.css.ts`:

```ts
import { css } from '@styled/css';

export const viewerVideo = css({
  maxW: '[100%]',
  maxH: '[100%]',
  m: 'auto',
});

export const viewerErrorRoot = css({
  display: 'grid',
  gap: 'element',
  placeItems: 'center',
  p: 'block',
  color: 'fg.default',
});
```

- [ ] **Step 4: AudioViewer を実装する**

`audio/viewer.tsx`(video と同型。`<audio>` はファイル名も出す。`MediaLoadFailure` は同型の内部コンポーネントを各ファイルに持つ — plugin ディレクトリを跨いだ共有はまだ 2 箇所なので導入しない):

```tsx
import { useCallback, useState } from 'react';
import { Link } from 'react-aria-components';

import { resolvePlayback } from '../../playback/registry';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';

const MediaLoadFailure = ({ object, getContentUrl, message }: ViewerProps & { readonly message: string }) => (
  <div className={styles.viewerErrorRoot} role="alert">
    <p>{message}</p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);

const AudioViewer = ({ object, getContentUrl }: ViewerProps) => {
  const [hasLoadError, setHasLoadError] = useState(false);
  const handleError = useCallback(() => setHasLoadError(true), []);

  if (hasLoadError) return <MediaLoadFailure object={object} getContentUrl={getContentUrl} message="音声を読み込めませんでした" />;

  return resolvePlayback({ object, getContentUrl }).match(
    (playback) => {
      switch (playback.kind) {
        case 'raw':
          return (
            <div className={styles.viewerAudioRoot}>
              <p className={styles.viewerAudioName}>{object.name}</p>
              <audio className={styles.viewerAudio} controls preload="metadata" src={playback.src} onError={handleError} />
            </div>
          );
        default: {
          const _exhaustive: never = playback.kind;
          throw new Error(`unhandled playback: ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
    () => <MediaLoadFailure object={object} getContentUrl={getContentUrl} message="再生ソースを解決できませんでした" />,
  );
};

export default AudioViewer;
```

`audio/styles.css.ts`:

```ts
import { css } from '@styled/css';

export const viewerAudioRoot = css({
  display: 'grid',
  gap: 'element',
  placeItems: 'center',
  p: 'block',
});

export const viewerAudioName = css({
  fontFamily: 'mono',
  color: 'fg.default',
});

export const viewerAudio = css({
  w: '[100%]',
  maxW: '[calc(var(--sizes-grid-cell) * 20)]',
});

export const viewerErrorRoot = css({
  display: 'grid',
  gap: 'element',
  placeItems: 'center',
  p: 'block',
  color: 'fg.default',
});
```

- [ ] **Step 5: プラグインを view に昇格する**

`video/index.tsx` / `audio/index.tsx`: `const VideoViewer = lazy(() => import('./viewer'));`(モジュールレベル)を足し、`capability: { kind: 'view', Viewer: VideoViewer }` に置き換える。暫定コメントを消す。

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/plugins --config vitest.config.ts`
Expected: PASS

- [ ] **Step 7: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/plugins/
git commit -m "feat(web): video / audio にネイティブ controls の Viewer を実装する"
```

---

### Task 6: 前後移動ロジック `findAdjacentViewable`

**Files:**
- Create: `apps/web/src/routes/-components/object-viewer/use-viewer-navigation/index.ts`
- Create: `apps/web/src/routes/-components/object-viewer/use-viewer-navigation/use-viewer-navigation.test.ts`

**Interfaces:**
- Consumes: `resolveFileType`(file-type registry)、`ObjectDescriptor`
- Produces: `findAdjacentViewable(objects: readonly ObjectDescriptor[], currentKey: string, direction: 1 | -1): ObjectDescriptor | undefined` と `isViewable(object: ObjectDescriptor): boolean`。Task 7 の overlay が消費

- [ ] **Step 1: 失敗するテストを書く**

`use-viewer-navigation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { findAdjacentViewable } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string): ObjectDescriptor => ({ bucketId: 'b', key, name: key, contentType, size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });

// a.png(view)→ b.bin(opaque)→ c.jpg(view)→ d.bin(opaque)
const objects = [make('a.png', 'image/png'), make('b.bin', 'application/octet-stream'), make('c.jpg', 'image/jpeg'), make('d.bin', 'application/octet-stream')];

describe('findAdjacentViewable', () => {
  it('次の view 可能ファイルへ(opaque をスキップ)', () => {
    expect(findAdjacentViewable(objects, 'a.png', 1)?.key).toBe('c.jpg');
  });

  it('前の view 可能ファイルへ(opaque をスキップ)', () => {
    expect(findAdjacentViewable(objects, 'c.jpg', -1)?.key).toBe('a.png');
  });

  it('末尾では undefined(次ページは取りに行かない)', () => {
    expect(findAdjacentViewable(objects, 'c.jpg', 1)).toBeUndefined();
  });

  it('先頭では undefined', () => {
    expect(findAdjacentViewable(objects, 'a.png', -1)).toBeUndefined();
  });

  it('current が一覧に無ければ undefined(deep link で未ロードのケース)', () => {
    expect(findAdjacentViewable(objects, 'zzz.png', 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/routes/-components/object-viewer --config vitest.config.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装する**

`use-viewer-navigation/index.ts`:

```ts
import { resolveFileType } from '../../../../plugins/file-type/registry';

import type { ObjectDescriptor } from '@r2-drive/core';

export const isViewable = (object: ObjectDescriptor): boolean =>
  resolveFileType(object).match(
    (match) => match.capability.kind === 'view',
    () => false,
  );

// 一覧の描画順(= 現在のソート順)における前後の view 可能ファイル。
// 対象は読み込み済みページ内に限る。末尾に達したら undefined(次ページは取らない)。
export const findAdjacentViewable = (objects: readonly ObjectDescriptor[], currentKey: string, direction: 1 | -1): ObjectDescriptor | undefined => {
  const index = objects.findIndex((object) => object.key === currentKey);
  if (index === -1) return undefined;

  const candidates = direction === 1 ? objects.slice(index + 1) : [...objects.slice(0, index)].reverse();

  return candidates.find(isViewable);
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/routes/-components/object-viewer --config vitest.config.ts`
Expected: PASS(5 件)

- [ ] **Step 5: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/routes/-components/object-viewer/
git commit -m "feat(web): ビューアの前後移動ロジックを実装する(opaque スキップ・ページ内限定)"
```

---

### Task 7: `ObjectViewerOverlay` コンポーネント

**Files:**
- Create: `apps/web/src/queries/object.ts`
- Create: `apps/web/src/routes/-components/object-viewer/index.tsx`
- Create: `apps/web/src/routes/-components/object-viewer/styles.css.ts`
- Create: `apps/web/src/routes/-components/object-viewer/object-viewer.test.tsx`

**Interfaces:**
- Consumes: Task 2 の API(`client.buckets[':bucketId'].objects[':path{.+}'].$get`)、Task 3 の `capability`、Task 6 の `findAdjacentViewable`
- Produces:
  ```ts
  export type ViewerRequest = { readonly kind: 'closed' } | { readonly kind: 'open'; readonly objectKey: string };
  // Props: { client: ApiClient; bucketId: string; objects: readonly ObjectDescriptor[];
  //          request: ViewerRequest; getContentUrl: (o: ObjectDescriptor) => string;
  //          onClose: () => void; onNavigate: (key: string) => void }
  export const ObjectViewerOverlay: (props: Props) => JSX.Element | null;
  ```
  Task 8 の route 配線が消費

- [ ] **Step 1: 失敗するテストを書く**

`object-viewer.test.tsx`。jsdom + `@testing-library/react`。QueryClientProvider で包む:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ObjectViewerOverlay } from './index';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string): ObjectDescriptor => ({ bucketId: 'b', key, name: key, contentType, size: 1024, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });

const objects = [make('a.png', 'image/png'), make('b.bin', 'application/octet-stream'), make('c.jpg', 'image/jpeg')];

// deep link fetch 経路はこのテストでは踏まない(objects に必ず居る key を使う)ので、
// client はダミーで良い。fetch 経路は Task 12 のブラウザ確認で見る。
const client = {} as ApiClient;
const getContentUrl = (o: ObjectDescriptor) => `/content/${o.key}`;

const renderOverlay = (props: Partial<Parameters<typeof ObjectViewerOverlay>[0]> = {}) => {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectViewerOverlay client={client} bucketId="b" objects={objects} request={{ kind: 'open', objectKey: 'a.png' }} getContentUrl={getContentUrl} onClose={onClose} onNavigate={onNavigate} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, onNavigate };
};

describe('ObjectViewerOverlay', () => {
  it('closed のときは dialog を出さない', () => {
    renderOverlay({ request: { kind: 'closed' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open のとき dialog にファイル名とメタデータが出る', async () => {
    renderOverlay();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('a.png').length).toBeGreaterThan(0);
    expect(screen.getByText(/1,024 B/)).toBeTruthy();
  });

  it('ArrowRight で次の view 可能ファイル(opaque スキップ)へ navigate する', async () => {
    const { onNavigate } = renderOverlay();
    await screen.findByRole('dialog');
    await userEvent.keyboard('{ArrowRight}');
    expect(onNavigate).toHaveBeenCalledWith('c.jpg');
  });

  it('先頭で ArrowLeft は何もしない', async () => {
    const { onNavigate } = renderOverlay();
    await screen.findByRole('dialog');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('opaque の key を deep link で開くと「表示できません」を出す', async () => {
    renderOverlay({ request: { kind: 'open', objectKey: 'b.bin' } });
    await screen.findByRole('dialog');
    expect(await screen.findByText(/表示できません/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/routes/-components/object-viewer --config vitest.config.ts`
Expected: FAIL(`index.tsx` が存在しない)

- [ ] **Step 3: `objectQuery` を実装する**

`apps/web/src/queries/object.ts`(`objects.ts` の `objectsQuery` と同じ流儀。queryKey は `$url()` から作る):

```ts
import { request } from '@r2-drive/api/client';
import { queryOptions } from '@tanstack/react-query';

import type { ApiClient } from '@r2-drive/api/client';

// deep link(?view=<key>)で一覧に居ない descriptor を 1 件だけ取る。
export const objectQuery = (client: ApiClient, bucketId: string, key: string) => {
  const url = client.buckets[':bucketId'].objects[':path{.+}'].$url({ param: { bucketId, path: key } });

  return queryOptions({
    queryKey: ['api', url.pathname, url.search] as const,
    queryFn: () =>
      request(() => client.buckets[':bucketId'].objects[':path{.+}'].$get({ param: { bucketId, path: key } })).match(
        (descriptor) => descriptor,
        (error) => {
          throw error;
        },
      ),
  });
};
```

`request` の第一引数のシグネチャは `queries/objects.ts` の使い方に合わせる(実装を見て確認)。

- [ ] **Step 4: overlay を実装する**

`object-viewer/index.tsx`。構造: `ModalOverlay > Modal > Dialog`(delete-dialog と同じ)。中身は 3 層 — ① request が closed なら isOpen=false、② descriptor 解決(読み込み済み or `objectQuery`)、③ capability switch で Viewer 描画。

```tsx
import { useQuery } from '@tanstack/react-query';
import { Component, Suspense, useCallback, useEffect, useMemo } from 'react';
import { Button, Dialog, Link, Modal, ModalOverlay } from 'react-aria-components';

import { findCause, isInstanceOf, ObjectNotFoundError } from '@r2-drive/core';

import { resolveFileType } from '../../../plugins/file-type/registry';
import { objectQuery } from '../../../queries/object';
import { findAdjacentViewable } from './use-viewer-navigation/index';
import * as styles from './styles.css';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';
import type { KeyboardEvent, ReactNode } from 'react';

export type ViewerRequest = { readonly kind: 'closed' } | { readonly kind: 'open'; readonly objectKey: string };

type Props = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly objects: readonly ObjectDescriptor[];
  readonly request: ViewerRequest;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onClose: () => void;
  readonly onNavigate: (key: string) => void;
};

export const ObjectViewerOverlay = ({ client, bucketId, objects, request, getContentUrl, onClose, onNavigate }: Props) => {
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) onClose();
    },
    [onClose],
  );

  return (
    <ModalOverlay className={styles.overlay} isOpen={request.kind === 'open'} isDismissable onOpenChange={handleOpenChange}>
      <Modal className={styles.modalRoot}>
        {request.kind === 'open' ? (
          <ViewerDialog client={client} bucketId={bucketId} objects={objects} objectKey={request.objectKey} getContentUrl={getContentUrl} onClose={onClose} onNavigate={onNavigate} />
        ) : null}
      </Modal>
    </ModalOverlay>
  );
};
```

`ViewerDialog`(同ファイル内。route 専用コンポーネントの内部分割):

```tsx
type ViewerDialogProps = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly objects: readonly ObjectDescriptor[];
  readonly objectKey: string;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onClose: () => void;
  readonly onNavigate: (key: string) => void;
};

const ViewerDialog = ({ client, bucketId, objects, objectKey, getContentUrl, onClose, onNavigate }: ViewerDialogProps) => {
  const previous = useMemo(() => findAdjacentViewable(objects, objectKey, -1), [objects, objectKey]);
  const next = useMemo(() => findAdjacentViewable(objects, objectKey, 1), [objects, objectKey]);

  // 次が画像なら 1 枚だけ先読みする。連続閲覧の体感はこれが作る。
  useEffect(() => {
    if (next === undefined) return;
    const isImage = resolveFileType(next).match(
      (match) => match.typeId === 'image',
      () => false,
    );
    if (isImage) new Image().src = getContentUrl(next);
  }, [next, getContentUrl]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      // video/audio のシーク(←/→)を奪わない
      if (event.target instanceof HTMLMediaElement) return;
      if (event.key === 'ArrowLeft' && previous !== undefined) onNavigate(previous.key);
      if (event.key === 'ArrowRight' && next !== undefined) onNavigate(next.key);
    },
    [previous, next, onNavigate],
  );

  const handlePrevious = useCallback(() => {
    if (previous !== undefined) onNavigate(previous.key);
  }, [previous, onNavigate]);

  const handleNext = useCallback(() => {
    if (next !== undefined) onNavigate(next.key);
  }, [next, onNavigate]);

  const loaded = objects.find((object) => object.key === objectKey);

  return (
    <Dialog className={styles.dialogRoot} aria-label={loaded?.name ?? objectKey} onKeyDown={handleKeyDown}>
      <header className={styles.header}>
        <span className={styles.headerName}>{loaded?.name ?? objectKey}</span>
        <Button className={styles.closeButton} onPress={onClose}>
          閉じる
        </Button>
      </header>
      <div className={styles.body}>
        {loaded !== undefined ? <ResolvedViewer object={loaded} getContentUrl={getContentUrl} /> : <FetchedViewer client={client} bucketId={bucketId} objectKey={objectKey} getContentUrl={getContentUrl} />}
      </div>
      <footer className={styles.footer}>
        <Button className={styles.navButton} onPress={handlePrevious} isDisabled={previous === undefined}>
          ← 前へ
        </Button>
        {loaded !== undefined ? <ObjectMeta object={loaded} /> : <span className={styles.meta}>{objectKey}</span>}
        <Button className={styles.navButton} onPress={handleNext} isDisabled={next === undefined}>
          次へ →
        </Button>
      </footer>
    </Dialog>
  );
};
```

`ObjectMeta`(等幅 + tabular-nums。装飾ではなく情報):

```tsx
const byteFormat = new Intl.NumberFormat('en-US');

const ObjectMeta = ({ object }: { readonly object: ObjectDescriptor }) => (
  <span className={styles.meta}>
    {byteFormat.format(object.size)} B · {object.contentType} · {object.uploadedAt.slice(0, 10)}
  </span>
);
```

`FetchedViewer`(deep link 経路。not-found とその他エラーを分ける):

```tsx
type FetchedViewerProps = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly objectKey: string;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

const FetchedViewer = ({ client, bucketId, objectKey, getContentUrl }: FetchedViewerProps) => {
  const { data, error, isPending } = useQuery(objectQuery(client, bucketId, objectKey));

  if (isPending) return <p className={styles.stateNotice}>読み込み中</p>;
  if (error !== null) {
    if (findCause(error, isInstanceOf(ObjectNotFoundError)) !== undefined) {
      return (
        <p className={styles.stateNotice} role="alert">
          ファイルが見つかりません: {objectKey}
        </p>
      );
    }

    return (
      <p className={styles.stateNotice} role="alert">
        読み込みに失敗しました: {error.message}
      </p>
    );
  }

  return <ResolvedViewer object={data} getContentUrl={getContentUrl} />;
};
```

`ResolvedViewer`(capability の消費エッジ。exhaustive switch):

```tsx
type ResolvedViewerProps = { readonly object: ObjectDescriptor; readonly getContentUrl: (object: ObjectDescriptor) => string };

const ResolvedViewer = ({ object, getContentUrl }: ResolvedViewerProps) => {
  return resolveFileType(object).match(
    (match) => {
      const capability = match.capability;
      switch (capability.kind) {
        case 'view':
          return (
            <ViewerErrorBoundary fallback={<ViewerLoadFailure object={object} getContentUrl={getContentUrl} />}>
              <Suspense fallback={<p className={styles.stateNotice}>読み込み中</p>}>
                <capability.Viewer object={object} getContentUrl={getContentUrl} />
              </Suspense>
            </ViewerErrorBoundary>
          );
        case 'opaque':
          return <OpaqueNotice object={object} getContentUrl={getContentUrl} />;
        default: {
          const _exhaustive: never = capability;
          throw new Error(`unhandled capability: ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
    // opaquePlugin が最終防衛線なので err には到達しないが、型上の網羅として同じ表示に落とす
    () => <OpaqueNotice object={object} getContentUrl={getContentUrl} />,
  );
};

const OpaqueNotice = ({ object, getContentUrl }: ResolvedViewerProps) => (
  <div className={styles.stateNoticeGroup}>
    <p>このファイルは表示できません</p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);

const ViewerLoadFailure = ({ object, getContentUrl }: ResolvedViewerProps) => (
  <div className={styles.stateNoticeGroup} role="alert">
    <p>ビューアを読み込めませんでした(再読み込みしてください)</p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);
```

`ViewerErrorBoundary`(lazy import 失敗・ビューア内の throw を overlay 内に閉じ込める。class は method shorthand):

```tsx
type ViewerErrorBoundaryProps = { readonly fallback: ReactNode; readonly children: ReactNode };
type ViewerErrorBoundaryState = { readonly hasError: boolean };

class ViewerErrorBoundary extends Component<ViewerErrorBoundaryProps, ViewerErrorBoundaryState> {
  override state: ViewerErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ViewerErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
```

- [ ] **Step 5: styles を実装する**

`object-viewer/styles.css.ts`(delete-dialog の overlay パターンを踏襲。body はビューポートいっぱい):

```ts
import { css } from '@styled/css';

export const overlay = css({
  position: 'fixed',
  inset: '0',
  zIndex: 'modal',
  display: 'grid',
  placeItems: 'center',
  p: 'block',
  bg: '[oklch(0 0 0 / 0.5)]',
});

export const modalRoot = css({
  display: 'grid',
  w: '[100%]',
  h: '[100%]',
  bg: 'bg.canvas',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  boxShadow: 'xl',
});

export const dialogRoot = css({
  display: 'grid',
  gridTemplateRows: '[auto 1fr auto]',
  h: '[100%]',
  minH: '[0]',
  color: 'fg.default',
  outline: 'none',
});

export const header = css({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'element',
  p: 'element',
  borderBottomWidth: 'hairline',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.subtle',
});

export const headerName = css({
  fontFamily: 'mono',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const closeButton = css({
  px: 'element',
  py: 'inline',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  cursor: 'pointer',
});

export const body = css({
  display: 'grid',
  minH: '[0]',
  overflow: 'auto',
});

export const footer = css({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'element',
  p: 'element',
  borderTopWidth: 'hairline',
  borderTopStyle: 'solid',
  borderTopColor: 'border.subtle',
});

export const navButton = css({
  px: 'element',
  py: 'inline',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  cursor: 'pointer',
  _disabled: { opacity: '[0.4]', cursor: 'default' },
});

export const meta = css({
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 'sm',
  color: 'fg.muted',
});

export const stateNotice = css({
  placeSelf: 'center',
  p: 'block',
  color: 'fg.muted',
});

export const stateNoticeGroup = css({
  display: 'grid',
  gap: 'element',
  placeSelf: 'center',
  placeItems: 'center',
  p: 'block',
});
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/routes/-components/object-viewer --config vitest.config.ts`
Expected: PASS(5 件)。`react-aria-components` の Modal は jsdom で portal 描画される。`findByRole('dialog')` が拾えない場合は `screen.findByRole('dialog', {}, { timeout: 3000 })` にする前に、`ModalOverlay` の `isOpen` が渡っているかを疑うこと

- [ ] **Step 7: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/queries/object.ts apps/web/src/routes/-components/object-viewer/
git commit -m "feat(web): ObjectViewerOverlay を実装する(capability switch・前後移動・deep link 解決)"
```

---

### Task 8: route 配線(`?view=` search param と FileRow の onAction)

**Files:**
- Modify: `apps/web/src/routes/b.$bucketId.$.tsx`(validateSearch、overlay 描画、open/close/navigate ハンドラ)
- Modify: `apps/web/src/routes/-components/bucket-object-actions/index.tsx`(`onOpenObject` を素通しする)
- Modify: `apps/web/src/routes/-components/object-list/index.tsx`(FileRow に onAction)
- Test: `apps/web/src/routes/-components/object-list/object-list.test.tsx`(存在すれば追記、無ければ新規)

**Interfaces:**
- Consumes: Task 7 の `ObjectViewerOverlay` / `ViewerRequest`、Task 3 の `capability`
- Produces: `?view=<key>` での開閉が動く。`onOpenObject: (key: string) => void` が ObjectList → BucketObjectActions → route と配線される

- [ ] **Step 1: 失敗するテストを書く**

`object-list` のテストに追記(新規の場合は既存 component テストのセットアップに倣う。GridList は Virtualizer 内なので、テストは FileRow 単位ではなく ObjectList ごと render する):

```tsx
it('view 可能なファイル行のダブルクリックで onOpenObject が呼ばれる', async () => {
  const onOpenObject = vi.fn();
  renderObjectList({ objects: [make('a.png', 'image/png')], onOpenObject });
  const row = await screen.findByText('a.png');
  await userEvent.dblClick(row);
  expect(onOpenObject).toHaveBeenCalledWith('a.png');
});

it('opaque なファイル行のダブルクリックでは呼ばれない', async () => {
  const onOpenObject = vi.fn();
  renderObjectList({ objects: [make('a.bin', 'application/octet-stream')], onOpenObject });
  const row = await screen.findByText('a.bin');
  await userEvent.dblClick(row);
  expect(onOpenObject).not.toHaveBeenCalled();
});
```

`renderObjectList` ヘルパは ObjectList の必須 props(selectedKeys 等)をデフォルト埋めして render する。Virtualizer が jsdom で高さ 0 になり行が描画されない場合は、`vitest.setup.ts` の既存の ResizeObserver / geometry パッチを確認し、それでも不安定なら **このテストを ObjectRow(switch コンポーネント)を直接 render する形に落として良い**(検証対象は「view のときだけ onAction が付く」という分岐であって Virtualizer ではない)。

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/routes/-components/object-list --config vitest.config.ts`
Expected: FAIL(`onOpenObject` prop が存在しない)

- [ ] **Step 3: ObjectList に `onOpenObject` を配線する**

`object-list/index.tsx`:
- `Props` に `readonly onOpenObject: (key: string) => void;` を追加
- `ObjectList` の分割代入と `renderRow` の `useCallback` 依存に追加し、`ObjectRow` → `FileRow` へ素通しする
- `FileRow` を変更:

```tsx
const FileRow = ({ id, object, getContentUrl, onOpenObject }: FileRowProps) => {
  const match = resolveFileType(object).unwrapOr(undefined);
  const previewIdentity = JSON.stringify([object.bucketId, object.key, object.etag]);
  const handleAction = useCallback(() => onOpenObject(object.key), [object.key, onOpenObject]);
  const canView = match !== undefined && match.capability.kind === 'view';

  return (
    <GridListItem id={id} textValue={object.name} className={styles.tile} data-kind="object" {...(canView ? { onAction: handleAction } : {})}>
```

(`exactOptionalPropertyTypes` 下で `onAction: undefined` を渡せないため、spread の有無で分岐する — `r2/get.ts` の `toGetOptions` と同じ理由)

- [ ] **Step 4: BucketObjectActions を素通しにする**

`bucket-object-actions/index.tsx` の `Props` に `readonly onOpenObject: (key: string) => void;` を追加し、`<ObjectList ... onOpenObject={onOpenObject} />` へ渡す。

- [ ] **Step 5: route に search param と overlay を配線する**

`b.$bucketId.$.tsx`:

```tsx
import { z } from 'zod';
import { ObjectViewerOverlay } from './-components/object-viewer/index';
import type { ViewerRequest } from './-components/object-viewer/index';

// URL search は「無い」状態が正当なので optional。variant への変換は useSearch 直後に行い、
// optional をコンポーネント境界より内側に持ち込まない。
const viewerSearchSchema = z.object({ view: z.string().optional() });
```

Route 定義に `validateSearch: (search) => viewerSearchSchema.parse(search),` を追加。

`BucketWorkspace` 内:

```tsx
const { view } = Route.useSearch();
const viewerRequest: ViewerRequest = view === undefined ? { kind: 'closed' } : { kind: 'open', objectKey: view };

const handleOpenObject = useCallback(
  (key: string) => {
    void navigate({ to: '.', search: { view: key } });
  },
  [navigate],
);

const handleCloseViewer = useCallback(() => {
  void navigate({ to: '.', search: {} });
}, [navigate]);

// replace: 50 枚めくった履歴を 50 回戻らせない。戻る 1 回で overlay ごと閉じる。
const handleNavigateViewer = useCallback(
  (key: string) => {
    void navigate({ to: '.', search: { view: key }, replace: true });
  },
  [navigate],
);
```

JSX(`BucketObjectActions` の後ろに並べる):

```tsx
<ObjectViewerOverlay client={client} bucketId={bucketId} objects={objects} request={viewerRequest} getContentUrl={getContentUrl} onClose={handleCloseViewer} onNavigate={handleNavigateViewer} />
```

`navigate({ to: '.', ... })` が現在の params を維持するかは TanStack Router の版で挙動が違うことがある。動かなければ `navigate({ to: '/b/$bucketId/$', params: { bucketId, _splat }, search: ... })` に落とす(`_splat` は `Route.useParams()` から取れる)。

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/routes --config vitest.config.ts`
Expected: PASS(既存の route 系テスト含む)

- [ ] **Step 7: dev server で手動確認**

Run: `pnpm dev` → `http://localhost:5173/b/<bucket>/` で:
1. 画像をダブルクリック → overlay が開き URL に `?view=` が付く
2. ESC / 閉じる → 一覧に戻りスクロール位置が保持されている
3. `?view=` 付き URL を再読み込み → ビューアが直接開く
4. ←/→ で前後移動、ブラウザバック 1 回で閉じる

- [ ] **Step 8: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/routes/
git commit -m "feat(web): ?view= search param でビューア overlay を開閉する"
```

---

### Task 9: highlight モジュールと CodeBlock コンポーネント

**Files:**
- Create: `apps/web/src/highlight/index.ts`
- Create: `apps/web/src/highlight/highlight.test.ts`
- Create: `apps/web/src/components/code-block/index.tsx`
- Create: `apps/web/src/components/code-block/styles.css.ts`
- Create: `apps/web/src/components/code-block/code-block.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `colors.code.*` token
- Produces:
  ```ts
  export type HighlightLanguage = keyof typeof LANGUAGE_IMPORTS; // 'typescript' | 'tsx' | ...
  export const PRELOADED_LANGUAGE_KEYS: readonly HighlightLanguage[];
  export const isHighlightLanguage: (value: string) => value is HighlightLanguage;
  export const highlightCode: (code: string, language: string) => Promise<string>; // shiki の HTML
  export const CodeBlock: (props: { readonly code: string; readonly language: string }) => JSX.Element;
  ```
  Task 10(markdown viewer)と Task 11(text viewer)が消費

- [ ] **Step 1: 依存を追加する**

```bash
pnpm --filter web add shiki@^4.4.3 @shikijs/langs@^4.4.3
```

- [ ] **Step 2: 失敗するテストを書く**

`highlight/highlight.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { highlightCode, isHighlightLanguage, PRELOADED_LANGUAGE_KEYS } from './index';

describe('highlight', () => {
  it('既知の言語はトークン別の CSS 変数で色付く', async () => {
    const html = await highlightCode('const a = 1;', 'typescript');
    expect(html).toContain('var(--shiki-');
    expect(html).toContain('<pre');
  });

  it('未知の言語は plain(text)として描画される', async () => {
    const html = await highlightCode('hello', 'not-a-language');
    expect(html).toContain('<pre');
    expect(html).toContain('hello');
  });

  it('コード内の HTML はエスケープされる(XSS)', async () => {
    const html = await highlightCode('<script>alert(1)</script>', 'not-a-language');
    expect(html).not.toContain('<script>');
  });

  it('isHighlightLanguage は PRELOADED_LANGUAGE_KEYS と 1:1', () => {
    for (const key of PRELOADED_LANGUAGE_KEYS) {
      expect(isHighlightLanguage(key)).toBe(true);
    }
    expect(isHighlightLanguage('cobol')).toBe(false);
  });
});
```

`code-block/code-block.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CodeBlock } from './index';

describe('CodeBlock', () => {
  it('ハイライト完了前も生のコードが見えている', () => {
    render(<CodeBlock code="const a = 1;" language="typescript" />);
    expect(screen.getByText('const a = 1;')).toBeTruthy();
  });

  it('ハイライト完了後は shiki の出力に置き換わる', async () => {
    const { container } = render(<CodeBlock code="const a = 1;" language="typescript" />);
    await waitFor(() => expect(container.querySelector('pre.shiki')).toBeTruthy());
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/highlight src/components/code-block --config vitest.config.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 4: highlight モジュールを実装する**

`highlight/index.ts`:

```ts
import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import type { HighlighterCore } from 'shiki/core';

// バンドラ制約: dynamic import のパスはリテラルでなければならない。
// この Record が言語リストの唯一の出典であり、PRELOADED_LANGUAGE_KEYS は
// ここから導出する(cross-module-sync-test: text プラグインの拡張子マップとの
// 整合は highlight.test.ts / text.test.tsx が固定する)。
const LANGUAGE_IMPORTS = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  css: () => import('@shikijs/langs/css'),
  html: () => import('@shikijs/langs/html'),
  bash: () => import('@shikijs/langs/bash'),
  toml: () => import('@shikijs/langs/toml'),
  markdown: () => import('@shikijs/langs/markdown'),
} as const;

export type HighlightLanguage = keyof typeof LANGUAGE_IMPORTS;

export const PRELOADED_LANGUAGE_KEYS = Object.keys(LANGUAGE_IMPORTS) as readonly HighlightLanguage[];

export const isHighlightLanguage = (value: string): value is HighlightLanguage => value in LANGUAGE_IMPORTS;

// 色は theme に埋めず CSS 変数で受ける。実際の色は code-block/styles.css.ts が
// colors.code.* token から与える(strictTokens と AA テストの保護をハイライトにも通す)。
const cssVariablesTheme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true });

// grammar は積まず theme だけ持って起動する。言語は highlightCode が要求時に load する
// (loadLanguage は冪等なので都度 await してよい)。
const highlighterPromise: Promise<HighlighterCore> = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [cssVariablesTheme],
});

export const highlightCode = async (code: string, language: string): Promise<string> => {
  const highlighter = await highlighterPromise;
  if (!isHighlightLanguage(language)) return highlighter.codeToHtml(code, { lang: 'text', theme: 'css-variables' });
  await highlighter.loadLanguage(LANGUAGE_IMPORTS[language]);

  return highlighter.codeToHtml(code, { lang: language, theme: 'css-variables' });
};
```

- [ ] **Step 5: CodeBlock を実装する**

`code-block/index.tsx`:

```tsx
import { useEffect, useState } from 'react';

import { highlightCode } from '../../highlight/index';
import * as styles from './styles.css';

type Props = { readonly code: string; readonly language: string };

type CodeBlockState = { readonly kind: 'pending' } | { readonly kind: 'ready'; readonly html: string };

export const CodeBlock = ({ code, language }: Props) => {
  const [state, setState] = useState<CodeBlockState>({ kind: 'pending' });

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const html = await highlightCode(code, language);
      if (!controller.signal.aborted) setState({ kind: 'ready', html });
    };
    void run();

    return () => controller.abort();
  }, [code, language]);

  if (state.kind === 'pending') {
    return (
      <pre className={styles.plainPre}>
        <code>{code}</code>
      </pre>
    );
  }

  // shiki の出力は全テキストをエスケープ済み(highlight.test.ts の XSS ケースで固定)。
  // eslint-disable-next-line react/no-danger -- shiki が生成した HTML の描画にのみ使う
  return <div className={styles.root} dangerouslySetInnerHTML={{ __html: state.html }} />;
};
```

(oxlint が `dangerouslySetInnerHTML` を警告するルール名は実行して確認し、その名前で disable コメントを書くこと。警告が出なければコメントは不要)

`code-block/styles.css.ts`(shiki の CSS 変数 ↔ `colors.code.*` の対応表。これが唯一の色の出入口):

```ts
import { css } from '@styled/css';

// createCssVariablesTheme(prefix: --shiki-)が参照する変数へ code.* token を配る。
// constant→number, parameter→fg, string-expression→string, link→function に寄せる
// (code.* は 7 色。shiki 側の変数のほうが多いので近い役割へ束ねる)。
const shikiVariables = {
  '--shiki-foreground': 'token(colors.code.fg)',
  '--shiki-background': 'token(colors.code.bg)',
  '--shiki-token-constant': 'token(colors.code.number)',
  '--shiki-token-string': 'token(colors.code.string)',
  '--shiki-token-comment': 'token(colors.code.comment)',
  '--shiki-token-keyword': 'token(colors.code.keyword)',
  '--shiki-token-parameter': 'token(colors.code.fg)',
  '--shiki-token-function': 'token(colors.code.function)',
  '--shiki-token-string-expression': 'token(colors.code.string)',
  '--shiki-token-punctuation': 'token(colors.code.punctuation)',
  '--shiki-token-link': 'token(colors.code.function)',
} as const;

export const root = css({
  ...shikiVariables,
  minW: '[0]',
  '& pre': {
    p: 'element',
    bg: 'code.bg',
    fontFamily: 'mono',
    fontSize: 'sm',
    lineHeight: 'snug',
    overflowX: 'auto',
  },
});

export const plainPre = css({
  p: 'element',
  bg: 'code.bg',
  color: 'code.fg',
  fontFamily: 'mono',
  fontSize: 'sm',
  lineHeight: 'snug',
  overflowX: 'auto',
});
```

(Panda の nested selector `'& pre'` と CSS 変数の `token()` 参照が strictTokens で通るかを `pnpm --filter web exec panda codegen` 後の typecheck で確認する。CSS 変数のキーが型エラーになる場合は `style` prop ではなく `css.raw` ではなく、`globalCss` にしない — `css()` の第一階層に `'--shiki-foreground': 'token(...)'` を書く形は Panda が公式にサポートしている)

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/highlight src/components/code-block --config vitest.config.ts`
Expected: PASS(6 件)

- [ ] **Step 7: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/highlight/ apps/web/src/components/code-block/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): shiki v4 + CSS 変数テーマの highlight 基盤と CodeBlock を実装する"
```

---

### Task 10: サイズ上限ガードと MarkdownViewer

**Files:**
- Create: `apps/web/src/plugins/file-type/text-viewer-limit.ts`
- Create: `apps/web/src/plugins/file-type/text-viewer-limit.test.ts`
- Create: `apps/web/src/components/viewer-too-large/index.tsx`
- Create: `apps/web/src/components/viewer-too-large/styles.css.ts`
- Create: `apps/web/src/components/viewer-too-large/viewer-too-large.test.tsx`
- Create: `apps/web/src/queries/object-text.ts`
- Create: `apps/web/src/plugins/file-type/markdown/viewer.tsx`
- Create: `apps/web/src/plugins/file-type/markdown/styles.css.ts`
- Modify: `apps/web/src/plugins/file-type/markdown/index.tsx`(capability を view に昇格)
- Test: `apps/web/src/plugins/file-type/markdown/markdown.test.tsx`(既存に追記)

**Interfaces:**
- Consumes: `CodeBlock`(Task 9)、`ViewerProps`(Task 3)
- Produces:
  ```ts
  export const MAX_TEXT_VIEWER_BYTES = 1_048_576; // 1 MiB
  export type TextViewerAdmission = { readonly kind: 'ok' } | { readonly kind: 'too-large'; readonly size: number };
  export const admitTextViewer: (size: number) => TextViewerAdmission;
  export const objectTextQuery: (contentUrl: string) => /* queryOptions<string> */;
  export const ViewerTooLarge: (props: { object: ObjectDescriptor; getContentUrl: (o: ObjectDescriptor) => string }) => JSX.Element;
  ```
  Task 11(text viewer)が `admitTextViewer` / `objectTextQuery` / `ViewerTooLarge` を再利用する

- [ ] **Step 1: 失敗するテストを書く**

`text-viewer-limit.test.ts`(境界値):

```ts
import { describe, expect, it } from 'vitest';

import { admitTextViewer, MAX_TEXT_VIEWER_BYTES } from './text-viewer-limit';

describe('admitTextViewer', () => {
  it('ちょうど 1 MiB は ok', () => {
    expect(admitTextViewer(MAX_TEXT_VIEWER_BYTES)).toEqual({ kind: 'ok' });
  });

  it('1 バイト超過で too-large', () => {
    expect(admitTextViewer(MAX_TEXT_VIEWER_BYTES + 1)).toEqual({ kind: 'too-large', size: MAX_TEXT_VIEWER_BYTES + 1 });
  });
});
```

`markdown.test.tsx` に追記:

```tsx
it('markdown は view capability を持つ', () => {
  const result = markdownPlugin.run({ bucketId: 'b', key: 'a.md', name: 'a.md', contentType: 'text/markdown', size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });
  expect(result.isOk() && result.value.capability.kind).toBe('view');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/plugins/file-type --config vitest.config.ts`
Expected: FAIL

- [ ] **Step 3: 依存を追加してガード・共有部品を実装する**

```bash
pnpm --filter web add react-markdown@^10.1.0 remark-gfm@^4.0.1
```

`text-viewer-limit.ts`:

```ts
// markdown / text ビューアは本文全体をクライアントに読む方式の防衛線。
// descriptor.size で事前判定し、超過時は fetch 自体を発行しない(spec §6.2)。
export const MAX_TEXT_VIEWER_BYTES = 1_048_576; // 1 MiB

export type TextViewerAdmission = { readonly kind: 'ok' } | { readonly kind: 'too-large'; readonly size: number };

export const admitTextViewer = (size: number): TextViewerAdmission => (size <= MAX_TEXT_VIEWER_BYTES ? { kind: 'ok' } : { kind: 'too-large', size });
```

`components/viewer-too-large/index.tsx`:

```tsx
import { Link } from 'react-aria-components';

import * as styles from './styles.css';

import type { ObjectDescriptor } from '@r2-drive/core';

type Props = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

const byteFormat = new Intl.NumberFormat('en-US');

export const ViewerTooLarge = ({ object, getContentUrl }: Props) => (
  <div className={styles.root}>
    <p>
      大きすぎるため表示できません(<span className={styles.size}>{byteFormat.format(object.size)} B</span>)
    </p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);
```

`components/viewer-too-large/styles.css.ts`:

```ts
import { css } from '@styled/css';

export const root = css({
  display: 'grid',
  gap: 'element',
  placeSelf: 'center',
  placeItems: 'center',
  p: 'block',
  color: 'fg.default',
});

export const size = css({
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
});
```

`components/viewer-too-large/viewer-too-large.test.tsx`(render テスト最低 1 件):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ViewerTooLarge } from './index';

describe('ViewerTooLarge', () => {
  it('サイズとダウンロード導線が出る', () => {
    render(
      <ViewerTooLarge
        object={{ bucketId: 'b', key: 'big.md', name: 'big.md', contentType: 'text/markdown', size: 2_000_000, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' }}
        getContentUrl={() => '/content/big.md'}
      />,
    );
    expect(screen.getByText(/2,000,000 B/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ダウンロード' })).toBeTruthy();
  });
});
```

`queries/object-text.ts`:

```ts
import { queryOptions } from '@tanstack/react-query';

// content URL は etag 付き(?v=)で不変なので、成功したら二度と取り直さない。
export const objectTextQuery = (contentUrl: string) =>
  queryOptions({
    queryKey: ['object-text', contentUrl] as const,
    queryFn: async () => {
      const res = await fetch(contentUrl);
      if (!res.ok) throw new Error(`content fetch failed: ${res.status}`);

      return res.text();
    },
    staleTime: Infinity,
  });
```

- [ ] **Step 4: MarkdownViewer を実装する**

`markdown/viewer.tsx`:

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CodeBlock } from '../../../components/code-block/index';
import { ViewerTooLarge } from '../../../components/viewer-too-large/index';
import { objectTextQuery } from '../../../queries/object-text';
import { admitTextViewer } from '../text-viewer-limit';
import * as styles from './styles.css';

import type { ViewerProps } from '../types';
import type { ComponentProps } from 'react';

// react-markdown はコードブロックを <code className="language-xxx"> で渡してくる。
// className が無いものはインラインコード。
const MarkdownCode = ({ className, children }: ComponentProps<'code'>) => {
  const language = /language-(\w+)/.exec(className ?? '')?.[1];
  if (language === undefined) return <code className={styles.inlineCode}>{children}</code>;

  return <CodeBlock code={`${children}`.replace(/\n$/, '')} language={language} />;
};

const MarkdownViewer = ({ object, getContentUrl }: ViewerProps) => {
  const admission = admitTextViewer(object.size);

  switch (admission.kind) {
    case 'too-large':
      return <ViewerTooLarge object={object} getContentUrl={getContentUrl} />;
    case 'ok':
      return <MarkdownContent url={getContentUrl(object)} />;
    default: {
      const _exhaustive: never = admission;
      throw new Error(`unhandled admission: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const MarkdownContent = ({ url }: { readonly url: string }) => {
  const { data } = useSuspenseQuery(objectTextQuery(url));

  return (
    <article className={styles.markdownRoot}>
      <Markdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCode }}>
        {data}
      </Markdown>
    </article>
  );
};

export default MarkdownViewer;
```

(`useSuspenseQuery` の suspend は overlay 側の `Suspense`(Task 7 の `ResolvedViewer`)が受ける。fetch 失敗の throw は `ViewerErrorBoundary` が受ける)

`markdown/styles.css.ts`(和文本文は `lineHeight: 'jp'`。GFM テーブルは罫線を hairline で):

```ts
import { css } from '@styled/css';

export const markdownRoot = css({
  p: 'block',
  maxW: '[calc(var(--sizes-grid-cell) * 30)]',
  mx: 'auto',
  color: 'fg.default',
  lineHeight: 'jp',
  display: 'grid',
  gap: 'element',
  '& h1': { fontSize: '2xl', fontWeight: 'bold', lineHeight: 'snug' },
  '& h2': { fontSize: 'xl', fontWeight: 'bold', lineHeight: 'snug' },
  '& h3': { fontSize: 'lg', fontWeight: 'semibold', lineHeight: 'snug' },
  '& ul, & ol': { pl: 'block' },
  '& a': { color: 'accent.text', textDecoration: 'underline' },
  '& table': { borderCollapse: 'collapse' },
  '& th, & td': {
    borderWidth: 'hairline',
    borderStyle: 'solid',
    borderColor: 'border.default',
    px: 'element',
    py: 'inline',
  },
  '& blockquote': {
    borderLeftWidth: 'strong',
    borderLeftStyle: 'solid',
    borderLeftColor: 'border.strong',
    pl: 'element',
    color: 'fg.muted',
  },
});

export const inlineCode = css({
  fontFamily: 'mono',
  fontSize: 'sm',
  bg: 'code.bg',
  color: 'code.fg',
  px: 'inline',
});
```

- [ ] **Step 5: markdownPlugin を view に昇格する**

`markdown/index.tsx`: `const MarkdownViewer = lazy(() => import('./viewer'));`(モジュールレベル)を足し、`capability: { kind: 'view', Viewer: MarkdownViewer }` に置き換える。

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/plugins/file-type src/components/viewer-too-large --config vitest.config.ts`
Expected: PASS

- [ ] **Step 7: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/plugins/file-type/ apps/web/src/components/viewer-too-large/ apps/web/src/queries/object-text.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): markdown ビューアを実装する(GFM + shiki、1MiB ガード)"
```

---

### Task 11: textPlugin と TextViewer

**Files:**
- Create: `apps/web/src/plugins/file-type/text/index.tsx`
- Create: `apps/web/src/plugins/file-type/text/viewer.tsx`
- Create: `apps/web/src/plugins/file-type/text/text.test.tsx`
- Modify: `apps/web/src/plugins/file-type/registry.ts`(audio の後・opaque の前に挿入)
- Modify: `apps/web/src/plugins/file-type/registry.test.ts`(順序テスト追記)

**Interfaces:**
- Consumes: `CodeBlock` / `isHighlightLanguage` / `HighlightLanguage`(Task 9)、`admitTextViewer` / `objectTextQuery` / `ViewerTooLarge`(Task 10)
- Produces: `textPlugin`(typeId: 'text')。`languageOf(name: string): HighlightLanguage | 'text'` を export(テスト対象)

- [ ] **Step 1: 失敗するテストを書く**

`text/text.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';

import { PRELOADED_LANGUAGE_KEYS } from '../../../highlight/index';
import { resolveFileType } from '../registry';
import { EXTENSION_LANGUAGES, languageOf, textPlugin } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const make = (key: string, contentType: string): ObjectDescriptor => ({ bucketId: 'b', key, name: key.split('/').pop() ?? key, contentType, size: 1, uploadedAt: '2026-01-01T00:00:00.000Z', etag: '"x"' });

describe('textPlugin', () => {
  it('text/* の contentType にマッチする', () => {
    const result = textPlugin.run(make('a.txt', 'text/plain'));
    expect(result.isOk() && result.value.typeId).toBe('text');
  });

  it('コード系拡張子は contentType が octet-stream でもマッチする', () => {
    const result = textPlugin.run(make('config.toml', 'application/octet-stream'));
    expect(result.isOk() && result.value.typeId).toBe('text');
  });

  it('画像にはマッチしない', () => {
    expect(textPlugin.run(make('a.png', 'image/png')).isErr()).toBe(true);
  });

  it('view capability を持つ', () => {
    const result = textPlugin.run(make('a.txt', 'text/plain'));
    expect(result.isOk() && result.value.capability.kind).toBe('view');
  });
});

describe('languageOf', () => {
  it('拡張子から言語を引く', () => {
    expect(languageOf('app.ts')).toBe('typescript');
    expect(languageOf('styles.css')).toBe('css');
  });

  it('未知の拡張子は text', () => {
    expect(languageOf('notes.unknown')).toBe('text');
  });
});

describe('registry との整合', () => {
  it('.md は markdown が先に取る(text に落ちない)', () => {
    const result = resolveFileType(make('readme.md', 'text/markdown'));
    expect(result.isOk() && result.value.typeId).toBe('markdown');
  });

  it('text/markdown は markdownPlugin が取るので textPlugin に届かない(順序保証)', () => {
    // registry 順: markdown → ... → text。ここでは registry を通した結果だけを固定する。
    const result = resolveFileType(make('readme.markdown', 'text/markdown'));
    expect(result.isOk() && result.value.typeId).toBe('markdown');
  });

  it('拡張子マップの言語はすべて highlight が読み込める(cross-module-sync)', () => {
    for (const language of Object.values(EXTENSION_LANGUAGES)) {
      expect(PRELOADED_LANGUAGE_KEYS).toContain(language);
    }
  });
});
```

`registry.test.ts` に追記(既存の順序テストのスタイルに合わせる):

```ts
it('text は audio の後・opaque の前', () => {
  const ids = fileTypePlugins.map((plugin) => plugin.id);
  expect(ids.indexOf('text')).toBeGreaterThan(ids.indexOf('audio'));
  expect(ids.indexOf('text')).toBeLessThan(ids.indexOf('opaque'));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter web exec vitest run src/plugins/file-type --config vitest.config.ts`
Expected: FAIL(text モジュールが存在しない)

- [ ] **Step 3: textPlugin を実装する**

`text/index.tsx`:

```tsx
import { err, ok } from 'neverthrow';
import { lazy } from 'react';

import { FileIcon, FilePreviewIcon } from '../../../components/file-icon/index';

import type { HighlightLanguage } from '../../../highlight/index';
import type { FileTypePlugin, PreviewProps } from '../types';

// 拡張子 → shiki 言語。値は highlight/index.ts の LANGUAGE_IMPORTS のキーに
// 限定される(HighlightLanguage で型的に、text.test.tsx の sync テストで実行時に固定)。
export const EXTENSION_LANGUAGES = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.css': 'css',
  '.html': 'html',
  '.sh': 'bash',
  '.bash': 'bash',
  '.toml': 'toml',
} as const satisfies Record<string, HighlightLanguage>;

// ハイライトしないが text として開く拡張子
const PLAIN_EXTENSIONS = ['.txt', '.log', '.csv'];

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');

  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

export const languageOf = (name: string): HighlightLanguage | 'text' => {
  const extension = extensionOf(name);

  return extension in EXTENSION_LANGUAGES ? EXTENSION_LANGUAGES[extension as keyof typeof EXTENSION_LANGUAGES] : 'text';
};

const matches = (contentType: string, name: string): boolean => {
  if (contentType.startsWith('text/')) return true;
  const extension = extensionOf(name);

  return extension in EXTENSION_LANGUAGES || PLAIN_EXTENSIONS.includes(extension);
};

const TextPreview = (_props: PreviewProps) => (
  <span data-preview-kind="icon">
    <FilePreviewIcon glyph="doc" />
  </span>
);

const TextViewer = lazy(() => import('./viewer'));

// 既知の罠: .ts に video/mp2t が付いた場合は registry 順で video が先に取る(spec §6 で許容)。
export const textPlugin: FileTypePlugin = {
  id: 'text',
  run: (object) =>
    matches(object.contentType, object.name)
      ? ok({
          typeId: 'text',
          label: 'テキスト',
          Icon: (props) => <FileIcon {...props} glyph="doc" />,
          Preview: TextPreview,
          capability: { kind: 'view', Viewer: TextViewer },
        })
      : err(object),
};
```

`text/viewer.tsx`:

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';

import { CodeBlock } from '../../../components/code-block/index';
import { ViewerTooLarge } from '../../../components/viewer-too-large/index';
import { objectTextQuery } from '../../../queries/object-text';
import { admitTextViewer } from '../text-viewer-limit';
import { languageOf } from './index';

import type { ViewerProps } from '../types';

const TextViewer = ({ object, getContentUrl }: ViewerProps) => {
  const admission = admitTextViewer(object.size);

  switch (admission.kind) {
    case 'too-large':
      return <ViewerTooLarge object={object} getContentUrl={getContentUrl} />;
    case 'ok':
      return <TextContent url={getContentUrl(object)} language={languageOf(object.name)} />;
    default: {
      const _exhaustive: never = admission;
      throw new Error(`unhandled admission: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const TextContent = ({ url, language }: { readonly url: string; readonly language: string }) => {
  const { data } = useSuspenseQuery(objectTextQuery(url));

  return <CodeBlock code={data} language={language} />;
};

export default TextViewer;
```

- [ ] **Step 4: registry に挿入する**

`registry.ts`:

```ts
import { textPlugin } from './text/index';

// 順序に意味がある(specific → broad)。opaque は必ず最後。
// text は「text/* または既知のコード系拡張子」と広めに取るので、markdown より後に置く。
export const fileTypePlugins = [markdownPlugin, imagePlugin, videoPlugin, audioPlugin, textPlugin, opaquePlugin] as const satisfies readonly FileTypePlugin[];
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter web exec vitest run src/plugins/file-type --config vitest.config.ts`
Expected: PASS(text 系 + registry 順序 + 既存全件)

- [ ] **Step 6: `pnpm lint && pnpm typecheck` を通して commit**

```bash
git add apps/web/src/plugins/file-type/
git commit -m "feat(web): テキスト / コードビューアの textPlugin を追加する"
```

---

### Task 12: 受け入れ基準の検証とレビュー依頼

**Files:**
- なし(検証のみ。修正が出たら該当タスクのファイルに戻る)

**Interfaces:**
- Consumes: 全タスクの成果物
- Produces: spec §11 の受け入れ基準 8 項目の判定。difit でのレビュー依頼

- [ ] **Step 1: 全テストスイートを回す**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 全プロジェクト(core / api / web)グリーン

- [ ] **Step 2: バンドル分離を検証する(受け入れ基準 8)**

```bash
pnpm --filter web build
# エントリチャンク(index-*.js など初期ロードされるもの)に shiki / react-markdown が
# 混入していないこと。viewer 系が独立チャンクになっていること。
grep -l "shikijs\|createHighlighterCore" apps/web/dist/client/assets/*.js
grep -l "remark-gfm" apps/web/dist/client/assets/*.js
```

Expected: shiki / react-markdown を含むチャンクが viewer 系の遅延チャンクのみ。判定に迷う場合は `vite build` の出力サイズ表で、エントリチャンクのサイズが Phase 1 時点(main での build)から大きく増えていない(目安 +10KB gzip 以内)ことを確認する。混入していたら import 経路を `grep -rn "from '.*highlight'" apps/web/src` で辿り、eager import を lazy 側へ移す。

- [ ] **Step 3: dev server で受け入れ基準を通しで確認する**

`pnpm dev` + シードデータ(`apps/web/scripts/seed-r2.ts` 参照)で:

1. ダブルクリック / Enter で overlay が開き、閉じるとスクロール位置・選択状態が保持される(基準 1)
2. `?view=` 付き URL の直接オープンでビューアが出る(基準 2)
3. 動画・音楽がシークできる(DevTools Network で 206 を確認)(基準 3)
4. markdown の GFM テーブル・タスクリスト・コードブロックのハイライト(基準 4)
5. ←/→ で前後移動、ブラウザバック 1 回で閉じる(基準 5)
6. 1 MiB 超のテキストで案内 + ダウンロード導線、Network に本文 fetch が出ない(基準 6)

(基準 7 = code.* AA は Task 1 のテストが、基準 8 は Step 2 が判定済み)

- [ ] **Step 4: difit でレビュー依頼**

```bash
npx difit main...HEAD
```

ユーザーにレビューを依頼し、指摘があれば該当タスクに戻って修正する。

- [ ] **Step 5: レビュー通過後、PR 作成(ユーザー承認後)**

`superpowers:finishing-a-development-branch` skill に従う。push / PR 作成はユーザーの指示を待つ。
