# r2-drive Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R2 バケットの中身を高速に閲覧し、GB 級ファイルをアップロードし、キーボードだけで複数選択して削除できる Drive UI を、単一の Cloudflare Worker として動かす。

**Architecture:** pnpm workspaces のモノレポ。`apps/web` が唯一デプロイされる Worker で、Hono の API 層(`packages/api`)と TanStack Start の SSR を 1 つの `fetch` ハンドラに合成する。Cloudflare Access が前段で認証を完結させる。拡張点はすべて `packages/core` の `createRunner` を共有する first-match プラグイン registry として実装し、コア側に分岐を増やさない。

**Tech Stack:** TanStack Start / Hono + Hono RPC (`hc`) / react-aria-components / Panda CSS / TanStack Query / neverthrow / Cloudflare R2 binding / `@uppy/core` + `@uppy/aws-s3` / vitest + `@cloudflare/vitest-pool-workers` / oxlint + oxfmt / tsgo

**Spec:** `docs/superpowers/specs/2026-08-14-r2-drive-design.md`

## Global Constraints

これらは全タスクの要件に暗黙に含まれる。

- **RSC を使わない。** `'use client'` はこのリポジトリに書かない。
- **optional field を作らない。**「A があるときだけ B がある」は 2 つの `?:` ではなく 2 つの variant(spec §6.1)。
- **エラーはクラス。** `extends Error` + `override name = '...'`。連鎖は ES2022 の `{ cause }` のみ。独自 `cause` フィールドを作らない(spec §6.2)。
- **`.match` は消費エッジ 1 箇所だけ。** service / domain 層は `ResultAsync` を返し続ける(spec §6.4)。
- **アロー関数のみ。** `func-style: ["error", "expression"]`(`.oxlintrc.json`)。
- **ファイル名は kebab-case。** `unicorn/filename-case`。
- **`as` ではなく `satisfies`。**
- **`readonly T[]`** を使う(`ReadonlyArray<T>` ではない)。
- **Hono のルートはメソッドチェーンで書く。** 途中で `const` に代入して分割すると RPC の型が積み上がらない(spec §8.1)。
- **`c.json()` のステータスはリテラルで書く。** 成功は `200`、失敗は `ErrorStatusCode` の union(spec §8.5)。
- **`@r2-drive/api`(Hono アプリの値)を import してよいのは `apps/web/src/worker.ts` だけ。** 他は `@r2-drive/api/client`(spec §11.3)。
- **`packages/*` は React を import しない。**
- **Worker が自分の公開ホスト名を `fetch()` しない。** SSR は `api.fetch(req, env, ctx)` を `hc` の `fetch` に差す(spec §8.4)。
- **共有依存のバージョンは `pnpm-workspace.yaml` の catalog で一元管理。** Hono がバックエンドとフロントエンドでずれると RPC の型が壊れる。
- **拡張点を作ってよいのは、実装が 2 つ以上あるか、名前のついたフェーズで 2 つ目が確定しているときだけ**(spec §1)。

### Phase 0 で意図的に作らないもの

- `ObjectHook`(アップロード後処理) — フックする実装が 0 個。Phase 1 で 2 つ同時に登場する
- `PlaybackResolver` — Phase 2
- `FileTypeCapability`(`Viewer` / `Editor`) — ビューアは Phase 2。Phase 0 の `FileTypeMatch` は `typeId` / `label` / `Icon` のみを持つ。spec §5.3 の形は Phase 2 で実装が 2 つ以上になった時点で導入する
- オブジェクトの移動 / リネーム / フォルダ作成 / ゴミ箱 / 共有リンク
- アップロードの中断からの再開(`uploadId` の永続化)

---

## File Structure

```
r2-drive/
├─ mise.toml                          既存
├─ pnpm-workspace.yaml                Task 1
├─ package.json                       Task 1(ルート。scripts のみ)
├─ tsconfig.base.json                 Task 1
├─ vitest.config.ts                   Task 1(ルート。test.projects で各パッケージを束ねる)
├─ apps/web/
│  ├─ package.json                    Task 2
│  ├─ wrangler.jsonc                  Task 2
│  ├─ vite.config.ts                  Task 2
│  ├─ panda.config.ts                 Task 2
│  ├─ vitest.config.ts                Task 2
│  └─ src/
│     ├─ worker.ts                    Task 2   Hono + Start の合成。唯一 @r2-drive/api を import する
│     ├─ router.tsx                   Task 2   TanStack Router + QueryClient
│     ├─ routes/
│     │  ├─ __root.tsx                Task 2
│     │  ├─ index.tsx                 Task 13  バケット一覧
│     │  ├─ b.$bucketId.$.tsx         Task 13  オブジェクト一覧
│     │  ├─ b.$bucketId.$.styles.css.ts   Task 13
│     │  └─ -components/
│     │     ├─ object-list/           Task 13  Virtualizer + GridList
│     │     ├─ upload-tray/           Task 14  Uppy の進捗表示
│     │     └─ delete-dialog/         Task 15
│     ├─ components/file-icon/        Task 12
│     ├─ api/client.ts                Task 11  ブラウザ用 ApiClient の生成
│     ├─ queries/objects.ts           Task 13  infiniteQueryOptions
│     └─ plugins/
│        ├─ file-type/                Task 12  registry.ts types.ts markdown/ image/ video/ audio/ opaque/
│        └─ object-action/            Task 12  registry.ts types.ts download/ copy-path/ delete/
└─ packages/
   ├─ core/
   │  ├─ package.json                 Task 3
   │  └─ src/
   │     ├─ create-runner.ts          Task 3   全拡張点が共有する唯一のディスパッチ実装
   │     ├─ object-descriptor.ts      Task 3   ObjectDescriptor / FolderDescriptor / ObjectPage
   │     └─ errors/
   │        ├─ index.ts               Task 4   エラークラス群 + DriveError union
   │        ├─ find-cause.ts          Task 4   findCause / describeCauseChain / isInstanceOf
   │        └─ wire.ts                Task 4   ErrorStatusCode / ErrorName / ErrorBody / ResponseSpec
   └─ api/
      ├─ package.json                 Task 5
      ├─ vitest.config.ts             Task 6
      └─ src/
         ├─ index.ts                  Task 6   Hono アプリ + AppType
         ├─ client.ts                 Task 11  hcWithType / ApiTransport / createApiClient / request
         ├─ env.ts                    Task 5   HonoEnv
         ├─ errors/responder/         Task 5   registry.ts types.ts object-not-found/ bucket-not-found/ …
         ├─ r2/
         │  ├─ registry.ts            Task 6   bucketDescriptors / BucketId / resolveBucket
         │  ├─ list.ts                Task 6
         │  ├─ range.ts               Task 8   parseRangeHeader(純粋関数)
         │  ├─ get.ts                 Task 8
         │  └─ delete.ts              Task 9
         ├─ identity/                 Task 7   types.ts cloudflare-access.ts static.ts factory.ts middleware.ts
         ├─ plugins/object-source/    Task 6   registry.ts types.ts r2-list/
         ├─ buckets/index.ts          Task 6   ルート定義(チェーン)
         └─ uploads/index.ts          Task 10  ルート定義(チェーン)
```

---

## Task 1: モノレポ基盤とツーリング

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`(既存の雛形を置き換え)
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`(ルート)
- Create: `packages/.gitkeep`, `apps/.gitkeep`

**Interfaces:**
- Consumes: なし
- Produces: `pnpm lint` / `pnpm fmt` / `pnpm typecheck` / `pnpm test` が動くワークスペース。catalog に `hono` / `react` / `react-dom` / `neverthrow` / `zod` / `@tanstack/react-query` が入る

- [ ] **Step 1: mise で node と pnpm を用意する**

```bash
mise trust && mise install
mise exec -- node --version   # v24.x
mise exec -- pnpm --version   # 10.34.5
```

- [ ] **Step 2: `pnpm-workspace.yaml` を書く**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

catalog:
  hono: ^4.10.3
  react: ^19.2.0
  react-dom: ^19.2.0
  neverthrow: ^8.2.0
  zod: ^4.1.12
  '@tanstack/react-query': ^5.90.2
```

バージョンは実際に解決される最新の安定版に合わせてよいが、**catalog に置くこと自体は必須**。Hono がバックエンドとフロントエンドでずれると RPC の型が静かに壊れる。

- [ ] **Step 3: ルート `package.json` を書く**

```json
{
  "name": "r2-drive",
  "private": true,
  "packageManager": "pnpm@10.34.5",
  "scripts": {
    "prepare": "husky",
    "fmt": "pnpm run fmt:oxfmt && pnpm run fmt:oxlint",
    "fmt:oxfmt": "oxfmt --write .",
    "fmt:oxlint": "oxlint --fix .",
    "lint": "pnpm run lint:oxfmt && pnpm run lint:oxlint",
    "lint:oxfmt": "oxfmt --check .",
    "lint:oxlint": "oxlint .",
    "typecheck": "tsgo --noEmit -p tsconfig.base.json",
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: devDependencies を 1 回で入れる**

husky の `prepare` ライフサイクルが husky 本体より先に走ると失敗するため、**必ず 1 回の `pnpm add -D` で入れる**。

```bash
mise exec -- pnpm add -D -w \
  '@typescript/native-preview' '@types/node@^22' \
  oxfmt oxlint \
  vitest '@vitest/coverage-v8' \
  husky
```

- [ ] **Step 5: `tsconfig.base.json` を書く**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@r2-drive/core": ["./packages/core/src/index.ts"],
      "@r2-drive/core/*": ["./packages/core/src/*"],
      "@r2-drive/api": ["./packages/api/src/index.ts"],
      "@r2-drive/api/client": ["./packages/api/src/client.ts"]
    }
  },
  "include": ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts", "packages/**/*.tsx", "*.ts"]
}
```

`noImplicitOverride` は必須。これが無いと `override name = '...'` を書き忘れてもエラーにならず、`modeling-errors-as-classes` の規約が効かなくなる。

- [ ] **Step 6: ルートの `vitest.config.ts` を書く**

vitest 4 で `test.workspace` は削除された。`test.projects` を使う。

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
  },
});
```

- [ ] **Step 7: husky を有効にする**

```bash
mise exec -- pnpm run prepare
chmod +x .husky/pre-commit
cat .husky/pre-commit    # "pnpm lint && pnpm typecheck" であること
```

- [ ] **Step 8: 全部通ることを確認する**

```bash
mise exec -- pnpm lint
mise exec -- pnpm typecheck
```

Expected: どちらも exit 0。`vitest run` はまだテストが 0 件なので実行しない。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspaces のモノレポ基盤を用意"
```

---

## Task 2: Walking skeleton — Hono と TanStack Start を 1 つの Worker に同居させる

**このタスクは機能実装ではなく検証である。** spec §4.2 / §11.6 が挙げた 4 つの未検証事項を潰し、通らなければ設計に戻る判断をここで下す。**先に進む前に必ず結果を報告すること。**

**Files:**
- Create: `apps/web/package.json`, `apps/web/wrangler.jsonc`, `apps/web/vite.config.ts`, `apps/web/panda.config.ts`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`
- Create: `apps/web/src/worker.ts`, `apps/web/src/router.tsx`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`
- Create: `apps/web/src/probe/union-status.ts`(検証用。Task 6 で削除する)

**Interfaces:**
- Consumes: Task 1 のワークスペース
- Produces: `apps/web` が `pnpm --filter web dev` で起動し、`/` が SSR され `/api/ping` が JSON を返す。以降のタスクはこの `worker.ts` の合成方法に依存する

- [ ] **Step 1: `apps/web` の依存を入れる**

```bash
mise exec -- pnpm --filter web add \
  '@tanstack/react-start' '@tanstack/react-router' \
  react@catalog: react-dom@catalog: \
  hono@catalog: '@hono/cloudflare-access' \
  '@tanstack/react-query@catalog:'

mise exec -- pnpm --filter web add -D \
  vite '@cloudflare/vite-plugin' wrangler \
  '@pandacss/dev' \
  '@cloudflare/workers-types'
```

- [ ] **Step 2: `wrangler.jsonc` を書く**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "r2-drive",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  // Access は Worker の前段にいるだけなので、workers.dev に直接叩かれると素通りする。
  // 受け入れ基準 5。絶対に true にしないこと。
  "workers_dev": false,
  "vars": {
    "ACCESS_TEAM": "REPLACE_WITH_ACCESS_TEAM",
    "ACCESS_AUD": "REPLACE_WITH_AUD_TAG",
    "IDENTITY_PROVIDER": "static"
  },
  "r2_buckets": [
    { "binding": "BUCKET_PHOTOS", "bucket_name": "REPLACE_WITH_PHOTOS_BUCKET" },
    { "binding": "BUCKET_MEDIA", "bucket_name": "REPLACE_WITH_MEDIA_BUCKET" }
  ]
}
```

- [ ] **Step 3: 型を生成する**

```bash
mise exec -- pnpm --filter web exec wrangler types --env-interface Env ./worker-configuration.d.ts
```

- [ ] **Step 4: `apps/web/src/worker.ts` を書く**

```ts
import { Hono } from 'hono';

// このファイルだけが @r2-drive/api を値として import してよい(spec §11.3)。
// Task 6 以降でここに実 API をマウントする。
const app = new Hono<{ Bindings: Env }>();

const api = new Hono<{ Bindings: Env }>().get('/ping', (c) => c.json({ ok: true }, 200));

app.route('/api', api);

export default app;
```

- [ ] **Step 5: TanStack Start を合成する(検証 A)**

TanStack Start が生成する Worker ハンドラを取得し、`app.all('*', ...)` に委譲する。**具体的な import 経路はバージョン依存なので、実物を見て決めること。** 想定は次の形。

```ts
import handler from '@tanstack/react-start/server-entry';

app.all('*', (c) => handler.fetch(c.req.raw, c.env, c.executionCtx));
```

これが成立しない場合の代替案を順に試す:

1. `apps/web/src/server.ts` に Start のカスタムサーバーエントリを置き、その中で `/api/*` だけ Hono に振る(向きを逆にする)
2. `@cloudflare/vite-plugin` の `main` を Start が生成するエントリに向け、Hono を Start のミドルウェア/プラグインとして差す

**どれも成立しなかった場合はここで止めて報告する。** フレームワーク選定に戻る判断が必要になる。

- [ ] **Step 6: Access ミドルウェアを配線する**

`env` はリクエスト時にしか存在しないので、ミドルウェア生成を `c.env` が読める位置に置く。

```ts
import { cloudflareAccess } from '@hono/cloudflare-access';

app.use('*', (c, next) => cloudflareAccess(c.env.ACCESS_TEAM, c.env.ACCESS_AUD)(c, next));
```

ローカル(`wrangler dev`)には Access が居ないため、`IDENTITY_PROVIDER === 'static'` のときはこのミドルウェアを飛ばす。Task 7 で `identityMiddleware` に統合する。

- [ ] **Step 7: 最小のルートを 1 つ置く**

```tsx
// apps/web/src/routes/__root.tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: () => (
    <html lang="ja">
      <body>
        <Outlet />
      </body>
    </html>
  ),
});
```

```tsx
// apps/web/src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => <h1>r2-drive</h1>,
});
```

- [ ] **Step 8: 起動して両方が返ることを確認する(検証 A の判定)**

```bash
mise exec -- pnpm --filter web dev
# 別シェルで
curl -s localhost:5173/api/ping          # {"ok":true}
curl -s localhost:5173/ | head -20       # SSR された <h1>r2-drive</h1> を含む HTML
```

Expected: 両方成功。片方でも失敗したら Step 5 の代替案に戻る。

- [ ] **Step 9: R2 binding に到達できることを確認する**

`api` に一時ルートを足す。

```ts
.get('/probe/r2', async (c) => {
  const listed = await c.env.BUCKET_PHOTOS.list({ limit: 1 });

  return c.json({ count: listed.objects.length }, 200);
})
```

```bash
curl -s localhost:5173/api/probe/r2       # {"count":0} など
```

- [ ] **Step 10: `c.json` に union の status を渡せるか検証する(検証 B)**

**spec §8.5 の A 案はこの検証に依存している。**

```ts
// apps/web/src/probe/union-status.ts
import { Hono } from 'hono';

type ErrorStatusCode = 400 | 404 | 409 | 412 | 500;
type ErrorBody = { readonly name: 'A'; readonly message: string } | { readonly name: 'B'; readonly message: string; readonly reason: 'x' };

const pickStatus = (): ErrorStatusCode => 404;
const pickBody = (): ErrorBody => ({ name: 'A', message: 'nope' });

export const probe = new Hono()
  .get('/ok', (c) => c.json({ value: 1 }, 200))
  .get('/err', (c) => c.json(pickBody(), pickStatus()));

export type ProbeType = typeof probe;
```

クライアント側で `res.ok` のナローイングが効くかを型で確かめる。

```ts
import { hc } from 'hono/client';
import type { ProbeType } from './union-status';

const client = hc<ProbeType>('http://localhost');

const check = async () => {
  const res = await client.ok.$get();
  if (!res.ok) return;
  const body = await res.json();
  // ここで body が { value: number } に絞られていること。
  // ErrorBody が混ざっていたら 2xx が ErrorStatusCode に漏れている。
  const _typecheck: number = body.value;

  return _typecheck;
};
```

```bash
mise exec -- pnpm typecheck
```

Expected: PASS。**失敗したら spec §8.5 を B 案(エッジで `switch` + `never` による網羅チェック)に切り替える必要がある。報告すること。**

- [ ] **Step 11: oxlint の `no-restricted-imports` が効くか検証する(検証 C)**

`apps/web/src/probe/restricted.ts` を一時的に作る。

```ts
import { Hono } from 'hono';

export const shouldFail = new Hono();
```

`.oxlintrc.json` の `no-restricted-imports` の `name` を一時的に `"hono"` に変え、`pnpm lint:oxlint` がこのファイルでエラーを出すことを確認する。確認後、設定を `@r2-drive/api` に戻し probe を削除する。

Expected: エラーが出る。**出なければ oxlint が未対応なので、受け入れ基準 6 を依存グラフ検査スクリプトで満たす方針に切り替える。報告すること。**

- [ ] **Step 12: Panda CSS を配線して tsgo との共存を確認する(検証 D)**

```bash
mise exec -- pnpm --filter web exec panda init --postcss
mise exec -- pnpm --filter web exec panda codegen
mise exec -- pnpm typecheck
```

`styled-system/` が生成され、`typecheck` が通ること。所要時間を計測して報告する(体感で不安があれば TypeScript project references の導入を Phase 1 で検討する)。

- [ ] **Step 13: probe を削除して Commit**

```bash
rm -rf apps/web/src/probe
git add -A
git commit -m "feat: TanStack Start と Hono を単一 Worker に合成する walking skeleton"
```

- [ ] **Step 14: 検証結果を報告する**

A(合成)/ B(union status)/ C(no-restricted-imports)/ D(tsgo + Panda)の 4 つについて、通ったか・回避策を採ったかを報告してから次のタスクに進む。

---

## Task 3: `packages/core` — createRunner とドメイン型

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/create-runner.ts`, `packages/core/src/create-runner.test.ts`
- Create: `packages/core/src/object-descriptor.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `Processor<I, O>` = `{ readonly id: string; run(input: I): Result<O, I> }`
  - `createRunner<I, O>(plugins: readonly Processor<I, O>[]): (input: I) => Result<O, I>`
  - `ObjectDescriptor` / `FolderDescriptor` / `ObjectPage` / `Prefix`

- [ ] **Step 1: パッケージを作る**

```json
// packages/core/package.json
{
  "name": "@r2-drive/core",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "dependencies": {
    "neverthrow": "catalog:"
  }
}
```

npm 公開しない内部パッケージなので `exports` をソースに向け、ビルド手順を持たない(spec §11.4)。

```json
// packages/core/tsconfig.json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

```ts
// packages/core/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: 'core', include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 2: 失敗するテストを書く**

```ts
// packages/core/src/create-runner.test.ts
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createRunner } from './create-runner';

import type { Processor } from './create-runner';

const upper: Processor<string, string> = {
  id: 'upper',
  run: (input) => (input.startsWith('u:') ? ok(input.slice(2).toUpperCase()) : err(input)),
};

const echo: Processor<string, string> = {
  id: 'echo',
  run: (input) => ok(input),
};

describe('createRunner', () => {
  it('最初に ok を返したプラグインの結果を採用する', () => {
    const run = createRunner([upper, echo]);

    expect(run('u:abc')).toEqual(ok('ABC'));
  });

  it('マッチしないプラグインを飛ばして後続に渡す', () => {
    const run = createRunner([upper, echo]);

    expect(run('plain')).toEqual(ok('plain'));
  });

  it('順序が意味を持つ — 先に置いた広いプラグインが後続を隠す', () => {
    const run = createRunner([echo, upper]);

    expect(run('u:abc')).toEqual(ok('u:abc'));
  });

  it('誰もマッチしなければ入力を err で返す', () => {
    const run = createRunner<string, string>([upper]);

    expect(run('plain')).toEqual(err('plain'));
  });

  it('プラグインが空でも入力を err で返す', () => {
    const run = createRunner<string, string>([]);

    expect(run('x')).toEqual(err('x'));
  });
});
```

- [ ] **Step 3: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/core/src/create-runner.test.ts`
Expected: FAIL — `Failed to resolve import "./create-runner"`

- [ ] **Step 4: 最小の実装を書く**

```ts
// packages/core/src/create-runner.ts
import { err } from 'neverthrow';

import type { Result } from 'neverthrow';

// 全拡張点が共有する唯一のディスパッチ実装。
// 新しいディスパッチ形(Map<k, fn> / switch / スコア方式)を発明しないこと。
export interface Processor<I, O> {
  readonly id: string;
  run(input: I): Result<O, I>;
}

const step = <I, O>(input: I, plugins: readonly Processor<I, O>[]): Result<O, I> => {
  const [head, ...tail] = plugins;
  if (head === undefined) return err(input);
  const result = head.run(input);
  if (result.isOk()) return result;

  return step(input, tail);
};

export const createRunner =
  <I, O>(plugins: readonly Processor<I, O>[]) =>
  (input: I): Result<O, I> =>
    step(input, plugins);
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/core/src/create-runner.test.ts`
Expected: PASS(5 件)

- [ ] **Step 6: ドメイン型を書く**

```ts
// packages/core/src/object-descriptor.ts

// R2 のキー空間には「/ で終わる共通接頭辞」しか存在しない。ディレクトリという実体は無い。
export type Prefix = string;

export type ObjectDescriptor = {
  readonly bucketId: string;
  readonly key: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly uploadedAt: string; // ISO8601。JSON を越えるので Date にしない
  readonly etag: string;
};

export type FolderDescriptor = {
  readonly bucketId: string;
  readonly prefix: Prefix;
  readonly name: string;
};

// カーソルの有無を optional ではなく variant で表す(spec §6.1)。
export type NextPage = { readonly kind: 'more'; readonly cursor: string } | { readonly kind: 'end' };

export type ObjectPage = {
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly next: NextPage;
};
```

`uploadedAt` を `Date` ではなく ISO8601 文字列にしているのは、この型が Hono RPC で JSON を越えるため。`Date` にすると server 側の型とクライアントが受け取る実体がずれる。

- [ ] **Step 7: `index.ts` を書く**

```ts
// packages/core/src/index.ts
export { createRunner } from './create-runner';
export type { Processor } from './create-runner';
export type { FolderDescriptor, NextPage, ObjectDescriptor, ObjectPage, Prefix } from './object-descriptor';
```

`no-barrel.md` はパッケージ内部の barrel を禁じているが、**パッケージの公開境界としての `index.ts` は別**。消費側は `@r2-drive/core` から import する。

- [ ] **Step 8: lint と typecheck**

```bash
mise exec -- pnpm lint && mise exec -- pnpm typecheck
```

- [ ] **Step 9: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): createRunner とドメイン型を追加"
```

---

## Task 4: `packages/core` — エラークラス、cause 探索、ワイヤ型

**Files:**
- Create: `packages/core/src/errors/index.ts`
- Create: `packages/core/src/errors/find-cause.ts`, `packages/core/src/errors/find-cause.test.ts`
- Create: `packages/core/src/errors/wire.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 3
- Produces:
  - `BucketNotFoundError` / `ObjectNotFoundError` / `UnauthenticatedError` / `PreconditionFailedError` / `UploadSessionError` / `R2OperationError` / `NetworkError` / `DriveError`
  - `isInstanceOf(ctor)` / `findCause(value, matches, depth?)` / `describeCauseChain(value, depth?)`
  - `ErrorStatusCode` / `ErrorName` / `ErrorBody` / `ResponseSpec` / `UploadFailureReason`

- [ ] **Step 1: エラークラスを書く**

```ts
// packages/core/src/errors/index.ts

// name は instanceof の判別子ではない。判別は instanceof で行う。
// name は log / 表示 / JSON を越えた先の wire 判別子のための安定 ID。
export class BucketNotFoundError extends Error {
  override name = 'BucketNotFoundError';
}
export class ObjectNotFoundError extends Error {
  override name = 'ObjectNotFoundError';
}
export class UnauthenticatedError extends Error {
  override name = 'UnauthenticatedError';
}
export class PreconditionFailedError extends Error {
  override name = 'PreconditionFailedError';
}
export class R2OperationError extends Error {
  override name = 'R2OperationError';
}
export class NetworkError extends Error {
  override name = 'NetworkError';
}

export type UploadFailureReason = 'part-too-small' | 'too-many-parts' | 'unknown-upload-id' | 'aborted';

export class UploadSessionError extends Error {
  override name = 'UploadSessionError';
  constructor(
    readonly reason: UploadFailureReason,
    options?: { cause?: unknown },
  ) {
    super(`upload session failed: ${reason}`, options);
  }
}

export type DriveError =
  | BucketNotFoundError
  | ObjectNotFoundError
  | UnauthenticatedError
  | PreconditionFailedError
  | UploadSessionError
  | R2OperationError
  | NetworkError;
```

- [ ] **Step 2: 失敗するテストを書く**

```ts
// packages/core/src/errors/find-cause.test.ts
import { describe, expect, it } from 'vitest';

import { ObjectNotFoundError, R2OperationError, UploadSessionError } from './index';
import { describeCauseChain, findCause, isInstanceOf } from './find-cause';

describe('findCause', () => {
  it('先頭が一致すればそれを返す', () => {
    const error = new ObjectNotFoundError('a.txt');

    expect(findCause(error, isInstanceOf(ObjectNotFoundError))).toBe(error);
  });

  it('cause チェーンの奥にあるものを見つける', () => {
    const root = new ObjectNotFoundError('a.txt');
    const wrapped = new UploadSessionError('aborted', { cause: new R2OperationError('boom', { cause: root }) });

    expect(findCause(wrapped, isInstanceOf(ObjectNotFoundError))).toBe(root);
  });

  it('一致するものが無ければ undefined', () => {
    const error = new R2OperationError('boom');

    expect(findCause(error, isInstanceOf(ObjectNotFoundError))).toBeUndefined();
  });

  it('Error ではない値で止まる', () => {
    const error = new R2OperationError('boom', { cause: 'not an error' });

    expect(findCause(error, isInstanceOf(ObjectNotFoundError))).toBeUndefined();
  });

  it('depth 上限で打ち切る', () => {
    const deep = Array.from({ length: 40 }).reduce<Error>(
      (acc) => new R2OperationError('wrap', { cause: acc }),
      new ObjectNotFoundError('a.txt'),
    );

    expect(findCause(deep, isInstanceOf(ObjectNotFoundError), 5)).toBeUndefined();
  });

  it('一致した時点で止まる — 奥まで歩かない', () => {
    const inner = new ObjectNotFoundError('inner');
    const outer = new ObjectNotFoundError('outer', { cause: inner });

    expect(findCause(outer, isInstanceOf(ObjectNotFoundError))).toBe(outer);
  });
});

describe('describeCauseChain', () => {
  it('チェーンを根まで平坦化する', () => {
    const error = new UploadSessionError('aborted', { cause: new ObjectNotFoundError('a.txt') });

    expect(describeCauseChain(error)).toEqual([
      'UploadSessionError: upload session failed: aborted',
      'ObjectNotFoundError: a.txt',
      'undefined',
    ]);
  });
});
```

- [ ] **Step 3: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/core/src/errors/find-cause.test.ts`
Expected: FAIL — `Failed to resolve import "./find-cause"`

- [ ] **Step 4: 実装を書く**

```ts
// packages/core/src/errors/find-cause.ts
type ErrorPredicate<T extends Error> = (value: unknown) => value is T;

export const isInstanceOf =
  <T extends Error>(ctor: abstract new (...args: never[]) => T): ErrorPredicate<T> =>
  (value): value is T =>
    value instanceof ctor;

// cause チェーンを根に向かって辿り、最初に一致したものを返す。
// 一致した時点で返るのでチェーンを最後まで歩かない。
// depth は暴走よけ。Error.cause に循環は作れないが、第三者の値が混ざる可能性はある。
export const findCause = <T extends Error>(value: unknown, matches: ErrorPredicate<T>, depth = 32): T | undefined => {
  if (matches(value)) return value;
  if (depth <= 0) return undefined;
  if (!(value instanceof Error)) return undefined;
  if (value.cause === undefined) return undefined;

  return findCause(value.cause, matches, depth - 1);
};

// ログ用。こちらは全走査する。
export const describeCauseChain = (value: unknown, depth = 32): readonly string[] => {
  if (!(value instanceof Error) || depth <= 0) return [String(value)];

  return [`${value.name}: ${value.message}`, ...describeCauseChain(value.cause, depth - 1)];
};
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/core/src/errors/find-cause.test.ts`
Expected: PASS(7 件)

- [ ] **Step 6: ワイヤ型を書く**

```ts
// packages/core/src/errors/wire.ts
import type { UploadFailureReason } from './index';

// 2xx を絶対に含めないこと。含めた瞬間に成功枝と status が重なり、
// hc 側で res.ok を書いてもエラー body 型が成功枝に漏れ込む。
export type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 412 | 429 | 500 | 503;

// エラークラスから導出できない。override name = '...' はベースの Error.name: string に
// 潰されるため DriveError['name'] はリテラル union にならない。ここで 1 度だけ宣言する。
export type ErrorName =
  | 'BucketNotFoundError'
  | 'ObjectNotFoundError'
  | 'UnauthenticatedError'
  | 'PreconditionFailedError'
  | 'UploadSessionError'
  | 'InternalError';

export type ErrorBody =
  | { readonly name: Exclude<ErrorName, 'UploadSessionError'>; readonly message: string }
  | { readonly name: 'UploadSessionError'; readonly message: string; readonly reason: UploadFailureReason };

export type ResponseSpec = { readonly status: ErrorStatusCode; readonly body: ErrorBody };
```

- [ ] **Step 7: `index.ts` に足す**

```ts
export * from './errors/index';
export { describeCauseChain, findCause, isInstanceOf } from './errors/find-cause';
export type { ErrorBody, ErrorName, ErrorStatusCode, ResponseSpec } from './errors/wire';
```

- [ ] **Step 8: lint / typecheck / test**

```bash
mise exec -- pnpm lint && mise exec -- pnpm typecheck && mise exec -- pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): エラークラス、cause チェーン探索、ワイヤ型を追加"
```

---

## Task 5: `packages/api` — errors responder registry

**Files:**
- Create: `packages/api/package.json`, `packages/api/tsconfig.json`, `packages/api/vitest.config.ts`
- Create: `packages/api/src/env.ts`
- Create: `packages/api/src/errors/responder/types.ts`
- Create: `packages/api/src/errors/responder/object-not-found/index.ts` ほか 4 つ
- Create: `packages/api/src/errors/responder/registry.ts`, `packages/api/src/errors/responder/registry.test.ts`

**Interfaces:**
- Consumes: `createRunner` / `Processor` / `DriveError` / `ResponseSpec`(Task 3, 4)
- Produces: `respondTo(value: unknown, depth?: number): ResponseSpec`

- [ ] **Step 1: パッケージを作る**

```json
// packages/api/package.json
{
  "name": "@r2-drive/api",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.ts"
  },
  "dependencies": {
    "@r2-drive/core": "workspace:*",
    "hono": "catalog:",
    "neverthrow": "catalog:",
    "zod": "catalog:",
    "@hono/zod-validator": "^0.7.0",
    "@hono/cloudflare-access": "^0.4.0",
    "range-parser": "^1.2.1",
    "mime": "^4.1.0"
  }
}
```

`exports` を 2 つに割っているのが依存方向の実体である。`apps/web` は `./client` だけを使い、`.`(Hono アプリの値)は `worker.ts` からしか触らない。

```ts
// packages/api/src/env.ts
export type HonoEnv = { Bindings: Env };
```

- [ ] **Step 2: 失敗するテストを書く**

```ts
// packages/api/src/errors/responder/registry.test.ts
import { ObjectNotFoundError, R2OperationError, UploadSessionError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { respondTo } from './registry';

describe('respondTo', () => {
  it('ObjectNotFoundError を 404 にする', () => {
    expect(respondTo(new ObjectNotFoundError('a.txt'))).toEqual({
      status: 404,
      body: { name: 'ObjectNotFoundError', message: 'a.txt' },
    });
  });

  it('UploadSessionError を 409 にし reason を載せる', () => {
    expect(respondTo(new UploadSessionError('part-too-small'))).toEqual({
      status: 409,
      body: { name: 'UploadSessionError', message: 'upload session failed: part-too-small', reason: 'part-too-small' },
    });
  });

  it('外側が勝つ — UploadSessionError に包まれた ObjectNotFoundError は 409', () => {
    const error = new UploadSessionError('aborted', { cause: new ObjectNotFoundError('a.txt') });

    expect(respondTo(error).status).toBe(409);
  });

  it('外側がマッチしなければ内側まで掘る', () => {
    const error = new R2OperationError('boom', { cause: new ObjectNotFoundError('a.txt') });

    expect(respondTo(error).status).toBe(404);
  });

  it('誰もマッチしなければ 500 で内部情報を漏らさない', () => {
    expect(respondTo(new R2OperationError('bucket=secret key=private.txt'))).toEqual({
      status: 500,
      body: { name: 'InternalError', message: 'internal error' },
    });
  });

  it('Error ではない値でも 500 を返す', () => {
    expect(respondTo('boom').status).toBe(500);
  });
});
```

- [ ] **Step 3: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/errors/responder/registry.test.ts`
Expected: FAIL — `Failed to resolve import "./registry"`

- [ ] **Step 4: responder の型と実装を書く**

```ts
// packages/api/src/errors/responder/types.ts
import type { Processor, ResponseSpec } from '@r2-drive/core';

export type ErrorResponder = Processor<Error, ResponseSpec>;
```

```ts
// packages/api/src/errors/responder/object-not-found/index.ts
import { ObjectNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const objectNotFoundResponder: ErrorResponder = {
  id: 'object-not-found',
  run: (error) =>
    error instanceof ObjectNotFoundError
      ? ok({ status: 404, body: { name: 'ObjectNotFoundError', message: error.message } })
      : err(error),
};
```

同じ形で 4 つ作る。**「Task N と同様」で済ませず、それぞれ書くこと。**

```ts
// packages/api/src/errors/responder/bucket-not-found/index.ts
import { BucketNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const bucketNotFoundResponder: ErrorResponder = {
  id: 'bucket-not-found',
  run: (error) =>
    error instanceof BucketNotFoundError
      ? ok({ status: 404, body: { name: 'BucketNotFoundError', message: error.message } })
      : err(error),
};
```

```ts
// packages/api/src/errors/responder/unauthenticated/index.ts
import { UnauthenticatedError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const unauthenticatedResponder: ErrorResponder = {
  id: 'unauthenticated',
  run: (error) =>
    error instanceof UnauthenticatedError
      ? ok({ status: 401, body: { name: 'UnauthenticatedError', message: error.message } })
      : err(error),
};
```

```ts
// packages/api/src/errors/responder/precondition-failed/index.ts
import { PreconditionFailedError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const preconditionFailedResponder: ErrorResponder = {
  id: 'precondition-failed',
  run: (error) =>
    error instanceof PreconditionFailedError
      ? ok({ status: 412, body: { name: 'PreconditionFailedError', message: error.message } })
      : err(error),
};
```

```ts
// packages/api/src/errors/responder/upload-session/index.ts
import { UploadSessionError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { ErrorResponder } from '../types';

export const uploadSessionResponder: ErrorResponder = {
  id: 'upload-session',
  run: (error) =>
    error instanceof UploadSessionError
      ? ok({ status: 409, body: { name: 'UploadSessionError', message: error.message, reason: error.reason } })
      : err(error),
};
```

- [ ] **Step 5: registry と `respondTo` を書く**

```ts
// packages/api/src/errors/responder/registry.ts
import { createRunner } from '@r2-drive/core';

import { bucketNotFoundResponder } from './bucket-not-found/index';
import { objectNotFoundResponder } from './object-not-found/index';
import { preconditionFailedResponder } from './precondition-failed/index';
import { unauthenticatedResponder } from './unauthenticated/index';
import { uploadSessionResponder } from './upload-session/index';

import type { ErrorResponder } from './types';
import type { ResponseSpec } from '@r2-drive/core';

// 順序に意味がある(specific → broad)。
export const errorResponders = [
  objectNotFoundResponder,
  bucketNotFoundResponder,
  unauthenticatedResponder,
  preconditionFailedResponder,
  uploadSessionResponder,
] as const satisfies readonly ErrorResponder[];

const resolveResponse = createRunner(errorResponders);

const INTERNAL_ERROR = { status: 500, body: { name: 'InternalError', message: 'internal error' } } satisfies ResponseSpec;

// cause チェーンを外側から 1 回だけ歩き、最初にマッチしたリンクで確定する。
// 優先順位はチェーンの外側優先。意味を変えるときだけ包むこと。
export const respondTo = (value: unknown, depth = 32): ResponseSpec => {
  if (!(value instanceof Error) || depth <= 0) return INTERNAL_ERROR;

  return resolveResponse(value).match(
    (spec) => spec,
    () => respondTo(value.cause, depth - 1),
  );
};
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/errors/responder/registry.test.ts`
Expected: PASS(6 件)

- [ ] **Step 7: Commit**

```bash
git add packages/api pnpm-lock.yaml
git commit -m "feat(api): エラー → レスポンスの responder registry を追加"
```

---

## Task 6: `packages/api` — R2 ゲートウェイと objects 一覧ルート

**Files:**
- Create: `packages/api/src/r2/registry.ts`, `packages/api/src/r2/registry.test.ts`
- Create: `packages/api/src/r2/list.ts`
- Create: `packages/api/src/plugins/object-source/types.ts`, `.../registry.ts`, `.../r2-list/index.ts`
- Create: `packages/api/src/buckets/index.ts`
- Create: `packages/api/src/index.ts`
- Create: `packages/api/src/errors/to-error-response.ts`
- Create: `packages/api/test/objects.integration.test.ts`
- Modify: `apps/web/src/worker.ts`(probe の api を `@r2-drive/api` に差し替え)

**Interfaces:**
- Consumes: Task 3, 4, 5
- Produces:
  - `bucketDescriptors` / `BucketId` / `resolveBucket(env, id): Result<R2Bucket, BucketNotFoundError>`
  - `AppType = typeof api`
  - `GET /api/buckets` → `{ buckets: readonly { id: BucketId; label: string }[] }`
  - `GET /api/buckets/:bucketId/objects?prefix=&cursor=` → `ObjectPage`

- [ ] **Step 1: vitest を Workers プールで動かす設定を書く**

```ts
// packages/api/vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    name: 'api',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    poolOptions: {
      workers: {
        miniflare: {
          r2Buckets: ['BUCKET_PHOTOS', 'BUCKET_MEDIA'],
          bindings: { ACCESS_TEAM: 'test', ACCESS_AUD: 'test', IDENTITY_PROVIDER: 'static' },
        },
      },
    },
  },
});
```

```bash
mise exec -- pnpm --filter @r2-drive/api add -D '@cloudflare/vitest-pool-workers'
```

R2 の `delimiter` 挙動と multipart の 5MiB 制約は**モックすると嘘になる**ので、本物のバインディング相手に検証する。

- [ ] **Step 2: バケット registry の失敗するテストを書く**

```ts
// packages/api/src/r2/registry.test.ts
import { env } from 'cloudflare:test';
import { BucketNotFoundError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { bucketDescriptors, resolveBucket } from './registry';

describe('resolveBucket', () => {
  it('登録済みの id から R2Bucket を返す', () => {
    const result = resolveBucket(env, 'photos');

    expect(result.isOk()).toBe(true);
  });

  it('未登録の id は BucketNotFoundError', () => {
    const result = resolveBucket(env, 'nope');

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BucketNotFoundError);
  });

  it('全ての descriptor が実在する binding を指している', () => {
    const missing = bucketDescriptors.filter((d) => env[d.binding] === undefined);

    expect(missing).toEqual([]);
  });
});
```

`_unsafeUnwrapErr()` はテストでのみ許される(`chaining-neverthrow-results`)。

- [ ] **Step 3: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/r2/registry.test.ts`
Expected: FAIL — `Failed to resolve import "./registry"`

- [ ] **Step 4: バケット registry を書く**

```ts
// packages/api/src/r2/registry.ts
import { BucketNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import type { Result } from 'neverthrow';

type BucketDescriptor = { readonly id: string; readonly label: string; readonly binding: keyof Env };

// バケット追加は wrangler.jsonc に 1 行 + ここに 1 行 + 再デプロイ。
export const bucketDescriptors = [
  { id: 'photos', label: '写真', binding: 'BUCKET_PHOTOS' },
  { id: 'media', label: 'メディア', binding: 'BUCKET_MEDIA' },
] as const satisfies readonly BucketDescriptor[];

// registry からリテラル union を導出する。バケットを足すと型が自動で広がる。
export type BucketId = (typeof bucketDescriptors)[number]['id'];

export const resolveBucket = (env: Env, id: string): Result<R2Bucket, BucketNotFoundError> => {
  const descriptor = bucketDescriptors.find((d) => d.id === id);
  if (descriptor === undefined) return err(new BucketNotFoundError(id));
  const bucket = env[descriptor.binding];
  if (bucket === undefined) return err(new BucketNotFoundError(`binding missing: ${descriptor.binding}`));

  return ok(bucket as R2Bucket);
};
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/r2/registry.test.ts`
Expected: PASS(3 件)

- [ ] **Step 6: list 実装を書く**

```ts
// packages/api/src/r2/list.ts
import { R2OperationError } from '@r2-drive/core';
import { fromPromise } from 'neverthrow';
import mime from 'mime';

import type { DriveError, ObjectPage, Prefix } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

const PAGE_SIZE = 200;

const nameOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

// R2 の httpMetadata が空のときは拡張子から確定させる。contentType を optional にしない。
const contentTypeOf = (key: string, meta: R2HTTPMetadata | undefined): string =>
  meta?.contentType ?? mime.getType(key) ?? 'application/octet-stream';

export type ListInput = { readonly bucket: R2Bucket; readonly bucketId: string; readonly prefix: Prefix; readonly cursor: string | undefined };

export const listObjects = (input: ListInput): ResultAsync<ObjectPage, DriveError> =>
  fromPromise(
    input.bucket.list({ prefix: input.prefix, delimiter: '/', limit: PAGE_SIZE, cursor: input.cursor, include: ['httpMetadata'] }),
    (cause) => new R2OperationError(`list failed: ${input.prefix}`, { cause }),
  ).map((listed) => ({
    // delimitedPrefixes が「フォルダ」の正体。ディレクトリという実体は R2 に無い。
    folders: listed.delimitedPrefixes.map((prefix) => ({ bucketId: input.bucketId, prefix, name: nameOf(prefix.slice(0, -1)) })),
    objects: listed.objects
      // prefix そのものを表す 0 バイトのマーカーは一覧に出さない
      .filter((object) => object.key !== input.prefix)
      .map((object) => ({
        bucketId: input.bucketId,
        key: object.key,
        name: nameOf(object.key),
        contentType: contentTypeOf(object.key, object.httpMetadata),
        size: object.size,
        uploadedAt: object.uploaded.toISOString(),
        etag: object.httpEtag,
      })),
    next: listed.truncated ? { kind: 'more', cursor: listed.cursor } : { kind: 'end' },
  }));
```

- [ ] **Step 7: ObjectSource 拡張点を書く**

```ts
// packages/api/src/plugins/object-source/types.ts
import type { DriveError, ObjectPage, Prefix, Processor } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

export type ListRequest = { readonly env: Env; readonly bucketId: string; readonly prefix: Prefix; readonly cursor: string | undefined };

// ディスパッチは同期(どのソースが担当するか)、仕事は非同期。
export type ObjectSource = Processor<ListRequest, ResultAsync<ObjectPage, DriveError>>;
```

```ts
// packages/api/src/plugins/object-source/r2-list/index.ts
import { errAsync, ok } from 'neverthrow';

import { resolveBucket } from '../../../r2/registry';
import { listObjects } from '../../../r2/list';

import type { ObjectSource } from '../types';

// 常に ok を返す最終防衛線。索引が無い / 追いついていないバケットの受け皿。
export const r2ListSource: ObjectSource = {
  id: 'r2-list',
  run: (input) =>
    ok(
      resolveBucket(input.env, input.bucketId).match(
        (bucket) => listObjects({ bucket, bucketId: input.bucketId, prefix: input.prefix, cursor: input.cursor }),
        (error) => errAsync(error),
      ),
    ),
};
```

```ts
// packages/api/src/plugins/object-source/registry.ts
import { createRunner } from '@r2-drive/core';

import { r2ListSource } from './r2-list/index';

import type { ObjectSource } from './types';

// Phase 1 で indexedSource をこの前に挿す。
export const objectSources = [r2ListSource] as const satisfies readonly ObjectSource[];

export const resolveObjectSource = createRunner(objectSources);
```

- [ ] **Step 8: `toErrorResponse` を書く**

```ts
// packages/api/src/errors/to-error-response.ts
import { describeCauseChain } from '@r2-drive/core';

import { respondTo } from './responder/registry';

import type { Context } from 'hono';

// cause チェーンはここでだけ意味を持つ。JSON を越えると消える。
// クライアントへは name と message だけ返す(R2 のキーやバケット名を漏らさない)。
export const toErrorResponse = (c: Context, error: unknown) => {
  console.error(c.req.url, describeCauseChain(error));
  const { status, body } = respondTo(error);

  return c.json(body, status);
};
```

- [ ] **Step 9: ルートを書く(チェーンを崩さないこと)**

```ts
// packages/api/src/buckets/index.ts
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { toErrorResponse } from '../errors/to-error-response';
import { bucketDescriptors } from '../r2/registry';
import { resolveObjectSource } from '../plugins/object-source/registry';

import type { HonoEnv } from '../env';

const listQuery = z.object({ prefix: z.string().default(''), cursor: z.string().optional() });

export const buckets = new Hono<HonoEnv>()
  .get('/', (c) => c.json({ buckets: bucketDescriptors.map(({ id, label }) => ({ id, label })) }, 200))
  .get('/:bucketId/objects', zValidator('query', listQuery), async (c) => {
    const { prefix, cursor } = c.req.valid('query');
    const request = { env: c.env, bucketId: c.req.param('bucketId'), prefix, cursor };

    return resolveObjectSource(request).match(
      (work) => work.match((page) => c.json(page, 200), (error) => toErrorResponse(c, error)),
      (input) => toErrorResponse(c, new Error(`no object source for bucket: ${input.bucketId}`)),
    );
  });
```

```ts
// packages/api/src/index.ts
import { Hono } from 'hono';

import { buckets } from './buckets/index';

import type { HonoEnv } from './env';

export const api = new Hono<HonoEnv>().route('/buckets', buckets);

export type AppType = typeof api;
```

- [ ] **Step 10: 統合テストを書く**

```ts
// packages/api/test/objects.integration.test.ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

const put = (key: string, body: string) => env.BUCKET_PHOTOS.put(key, body);

describe('GET /buckets/:bucketId/objects', () => {
  beforeEach(async () => {
    await put('a.txt', 'a');
    await put('docs/b.md', 'b');
    await put('docs/nested/c.md', 'c');
  });

  it('delimiter でフォルダとオブジェクトを分ける', async () => {
    const res = await api.request('/buckets/photos/objects', {}, env);
    expect(res.status).toBe(200);
    const page = await res.json();

    expect(page.objects.map((o) => o.key)).toEqual(['a.txt']);
    expect(page.folders.map((f) => f.prefix)).toEqual(['docs/']);
    expect(page.next).toEqual({ kind: 'end' });
  });

  it('prefix で潜れる', async () => {
    const res = await api.request('/buckets/photos/objects?prefix=docs%2F', {}, env);
    const page = await res.json();

    expect(page.objects.map((o) => o.name)).toEqual(['b.md']);
    expect(page.folders.map((f) => f.name)).toEqual(['nested']);
  });

  it('contentType が空でも拡張子から埋まる', async () => {
    const res = await api.request('/buckets/photos/objects?prefix=docs%2F', {}, env);
    const page = await res.json();

    expect(page.objects[0].contentType).toBe('text/markdown');
  });

  it('未登録バケットは 404 と BucketNotFoundError', async () => {
    const res = await api.request('/buckets/nope/objects', {}, env);
    expect(res.status).toBe(404);

    expect(await res.json()).toEqual({ name: 'BucketNotFoundError', message: 'nope' });
  });
});
```

- [ ] **Step 11: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api`
Expected: PASS

- [ ] **Step 12: `apps/web/src/worker.ts` を実 API に差し替える**

```ts
import { api } from '@r2-drive/api';

app.route('/api', api);
```

`apps/web/package.json` に `"@r2-drive/api": "workspace:*"` を足して `pnpm install`。

- [ ] **Step 13: 境界の lint が効いていることを確認する**

`apps/web/src/routes/index.tsx` に一時的に `import { api } from '@r2-drive/api';` を書き、`pnpm lint:oxlint` がエラーを出すことを確認してから消す。

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(api): R2 ゲートウェイと objects 一覧ルートを追加"
```

---

## Task 7: `packages/api` — Identity

**Files:**
- Create: `packages/api/src/identity/types.ts`, `.../cloudflare-access.ts`, `.../static.ts`, `.../factory.ts`, `.../middleware.ts`
- Create: `packages/api/src/identity/factory.test.ts`
- Modify: `packages/api/src/index.ts`, `apps/web/src/worker.ts`

**Interfaces:**
- Consumes: Task 4
- Produces:
  - `Identity` union / `IdentityProvider` / `IdentityProviderFactory`
  - `identityMiddleware` — `c.get('identity')` で `Identity` が取れる

- [ ] **Step 1: 型を書く**

```ts
// packages/api/src/identity/types.ts
import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

// Access のサービストークンは email も sub も持たず common_name になる。
// 最初から 2 系統を吸収する union にする。
export type Identity =
  | { readonly kind: 'user'; readonly id: string; readonly email: string; readonly displayName: string; readonly groups: readonly string[] }
  | { readonly kind: 'service'; readonly id: string; readonly commonName: string };

export type IdentityProvider = {
  readonly id: string;
  resolve(request: Request): ResultAsync<Identity, DriveError>;
};

export type IdentityProviderFactory = (env: Env) => IdentityProvider;
```

- [ ] **Step 2: 失敗するテストを書く**

```ts
// packages/api/src/identity/factory.test.ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createIdentityProvider } from './factory';

describe('createIdentityProvider', () => {
  it('IDENTITY_PROVIDER=static のとき static を返す', () => {
    expect(createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'static' }).id).toBe('static');
  });

  it('IDENTITY_PROVIDER=access のとき cloudflare-access を返す', () => {
    expect(createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'access' }).id).toBe('cloudflare-access');
  });

  it('static provider は固定の user Identity を返す', async () => {
    const provider = createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'static' });
    const identity = (await provider.resolve(new Request('http://localhost/')))._unsafeUnwrap();

    expect(identity.kind).toBe('user');
    expect(identity).toHaveProperty('displayName');
  });

  it('access provider は assertion が無ければ UnauthenticatedError', async () => {
    const provider = createIdentityProvider({ ...env, IDENTITY_PROVIDER: 'access' });
    const result = await provider.resolve(new Request('http://localhost/'));

    expect(result._unsafeUnwrapErr().name).toBe('UnauthenticatedError');
  });
});
```

- [ ] **Step 3: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/identity/factory.test.ts`
Expected: FAIL — `Failed to resolve import "./factory"`

- [ ] **Step 4: static provider を書く**

```ts
// packages/api/src/identity/static.ts
import { okAsync } from 'neverthrow';

import type { IdentityProviderFactory } from './types';

// wrangler dev には Access が居ない。これが無いとローカル開発ができない。
export const staticIdentity: IdentityProviderFactory = () => ({
  id: 'static',
  resolve: () =>
    okAsync({ kind: 'user', id: 'local', email: 'local@example.com', displayName: 'local', groups: [] }),
});
```

- [ ] **Step 5: Access provider を書く**

```ts
// packages/api/src/identity/cloudflare-access.ts
import { UnauthenticatedError } from '@r2-drive/core';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import type { Identity, IdentityProviderFactory } from './types';

type AccessPayload = { readonly sub?: string; readonly email?: string; readonly common_name?: string; readonly identity_nonce?: string };

type GetIdentityResponse = { readonly name?: string; readonly email?: string; readonly groups?: readonly { readonly name: string }[] };

// identity_nonce をキーに get-identity の結果を寝かせる。このクレームはまさにその用途で存在する。
const identityCache = new Map<string, Identity>();

const decodePayload = (jwt: string): AccessPayload | undefined => {
  const [, payload] = jwt.split('.');
  if (payload === undefined) return undefined;
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return undefined;
  }
};

export const cloudflareAccessIdentity: IdentityProviderFactory = (env) => ({
  id: 'cloudflare-access',
  resolve: (request) => {
    // 署名検証は前段の @hono/cloudflare-access が済ませている。ここは正規化だけ。
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (jwt === null) return errAsync(new UnauthenticatedError('missing Cf-Access-Jwt-Assertion'));
    const payload = decodePayload(jwt);
    if (payload === undefined) return errAsync(new UnauthenticatedError('malformed assertion'));

    if (payload.common_name !== undefined) {
      return okAsync({ kind: 'service', id: payload.common_name, commonName: payload.common_name });
    }

    const { sub, email, identity_nonce: nonce } = payload;
    if (sub === undefined || email === undefined) return errAsync(new UnauthenticatedError('assertion lacks sub/email'));

    const cached = nonce === undefined ? undefined : identityCache.get(nonce);
    if (cached !== undefined) return okAsync(cached);

    return fromPromise(
      fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/get-identity`, {
        headers: { cookie: request.headers.get('cookie') ?? '' },
      }).then((res) => (res.ok ? res.json() : ({} as GetIdentityResponse))),
      (cause) => new UnauthenticatedError('get-identity failed', { cause }),
    )
      .orElse(() => okAsync({} as GetIdentityResponse))
      .map((detail): Identity => {
        // displayName は常に存在する。無ければプロバイダが email に落とす責務を持つ。
        const identity = {
          kind: 'user',
          id: sub,
          email,
          displayName: detail.name ?? email,
          groups: (detail.groups ?? []).map((g) => g.name),
        } satisfies Identity;
        if (nonce !== undefined) identityCache.set(nonce, identity);

        return identity;
      });
  },
});
```

- [ ] **Step 6: factory と middleware を書く**

```ts
// packages/api/src/identity/factory.ts
import { cloudflareAccessIdentity } from './cloudflare-access';
import { staticIdentity } from './static';

import type { IdentityProvider } from './types';

// createRunner を使わない。first-match で static にフォールバックすると、
// 本番で Access 検証が落ちたとき開発用 Identity が通ってしまう。
export const createIdentityProvider = (env: Env): IdentityProvider =>
  env.IDENTITY_PROVIDER === 'static' ? staticIdentity(env) : cloudflareAccessIdentity(env);
```

```ts
// packages/api/src/identity/middleware.ts
import { createMiddleware } from 'hono/factory';

import { toErrorResponse } from '../errors/to-error-response';
import { createIdentityProvider } from './factory';

import type { Identity } from './types';

declare module 'hono' {
  interface ContextVariableMap {
    identity: Identity;
  }
}

export const identityMiddleware = createMiddleware(async (c, next) =>
  createIdentityProvider(c.env).resolve(c.req.raw).match(
    async (identity) => {
      c.set('identity', identity);

      return next();
    },
    async (error) => toErrorResponse(c, error),
  ),
);
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/identity/factory.test.ts`
Expected: PASS(4 件)

- [ ] **Step 8: worker に配線する**

```ts
// apps/web/src/worker.ts
import { api, identityMiddleware } from '@r2-drive/api';
import { cloudflareAccess } from '@hono/cloudflare-access';

app.use('*', (c, next) =>
  c.env.IDENTITY_PROVIDER === 'static' ? next() : cloudflareAccess(c.env.ACCESS_TEAM, c.env.ACCESS_AUD)(c, next),
);
app.use('*', identityMiddleware);
```

`packages/api/src/index.ts` から `identityMiddleware` を re-export する。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): Cloudflare Access と static の 2 実装を持つ Identity を追加"
```

---

## Task 8: `packages/api` — Range 対応のバイナリ配信

**Files:**
- Create: `packages/api/src/r2/range.ts`, `packages/api/src/r2/range.test.ts`
- Create: `packages/api/src/r2/get.ts`
- Modify: `packages/api/src/buckets/index.ts`
- Create: `packages/api/test/content.integration.test.ts`

**Interfaces:**
- Consumes: Task 6
- Produces:
  - `parseRangeHeader(header: string | null, size: number): R2RangeSpec`
  - `GET /api/buckets/:bucketId/content/:path{.+}` — 200 または 206 または 416

- [ ] **Step 1: 失敗するテストを書く**

```ts
// packages/api/src/r2/range.test.ts
import { describe, expect, it } from 'vitest';

import { parseRangeHeader } from './range';

describe('parseRangeHeader', () => {
  it('ヘッダが無ければ whole', () => {
    expect(parseRangeHeader(null, 1000)).toEqual({ kind: 'whole' });
  });

  it('bytes=0-99 は window', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ kind: 'window', offset: 0, length: 100 });
  });

  it('bytes=500- は offset のみ', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ kind: 'offset', offset: 500 });
  });

  it('bytes=-200 は suffix', () => {
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ kind: 'suffix', suffix: 200 });
  });

  it('終端がサイズを超えても切り詰めて返す', () => {
    expect(parseRangeHeader('bytes=900-2000', 1000)).toEqual({ kind: 'window', offset: 900, length: 100 });
  });

  it('複数レンジは非対応 — unsatisfiable', () => {
    expect(parseRangeHeader('bytes=0-99,200-299', 1000)).toEqual({ kind: 'unsatisfiable' });
  });

  it('範囲外は unsatisfiable', () => {
    expect(parseRangeHeader('bytes=2000-3000', 1000)).toEqual({ kind: 'unsatisfiable' });
  });

  it('壊れたヘッダは whole として扱う', () => {
    expect(parseRangeHeader('garbage', 1000)).toEqual({ kind: 'whole' });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/r2/range.test.ts`
Expected: FAIL — `Failed to resolve import "./range"`

- [ ] **Step 3: 実装を書く**

```ts
// packages/api/src/r2/range.ts
import parseRange from 'range-parser';

// 複数レンジ(multipart/byteranges)は非対応。ブラウザの <video> / <audio> は使わない。
export type R2RangeSpec =
  | { readonly kind: 'whole' }
  | { readonly kind: 'offset'; readonly offset: number }
  | { readonly kind: 'window'; readonly offset: number; readonly length: number }
  | { readonly kind: 'suffix'; readonly suffix: number }
  | { readonly kind: 'unsatisfiable' };

export const parseRangeHeader = (header: string | null, size: number): R2RangeSpec => {
  if (header === null) return { kind: 'whole' };

  // range-parser は suffix を解決済みの start/end に正規化するので、
  // 「末尾 N バイト」の意図を保つために先に自前で判定する。
  const suffix = /^bytes=-(\d+)$/.exec(header);
  if (suffix !== null) {
    const n = Number.parseInt(suffix[1] ?? '0', 10);

    return n === 0 ? { kind: 'unsatisfiable' } : { kind: 'suffix', suffix: Math.min(n, size) };
  }

  const parsed = parseRange(size, header, { combine: false });
  if (parsed === -1) return { kind: 'unsatisfiable' };
  if (parsed === -2) return { kind: 'whole' };
  if (parsed.type !== 'bytes' || parsed.length !== 1) return { kind: 'unsatisfiable' };

  const first = parsed[0];
  if (first === undefined) return { kind: 'unsatisfiable' };
  const openEnded = /^bytes=\d+-$/.test(header);

  return openEnded ? { kind: 'offset', offset: first.start } : { kind: 'window', offset: first.start, length: first.end - first.start + 1 };
};
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/r2/range.test.ts`
Expected: PASS(8 件)

- [ ] **Step 5: get 実装を書く**

```ts
// packages/api/src/r2/get.ts
import { ObjectNotFoundError, R2OperationError } from '@r2-drive/core';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import type { R2RangeSpec } from './range';
import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

const toR2Range = (spec: R2RangeSpec): R2Range | undefined => {
  switch (spec.kind) {
    case 'whole':
      return undefined;
    case 'offset':
      return { offset: spec.offset };
    case 'window':
      return { offset: spec.offset, length: spec.length };
    case 'suffix':
      return { suffix: spec.suffix };
    case 'unsatisfiable':
      return undefined;
    default: {
      const _exhaustive: never = spec;
      throw new Error(`unhandled range spec: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const getObject = (bucket: R2Bucket, key: string, spec: R2RangeSpec): ResultAsync<R2ObjectBody, DriveError> =>
  fromPromise(bucket.get(key, { range: toR2Range(spec) }), (cause) => new R2OperationError(`get failed: ${key}`, { cause })).andThen(
    (object) => (object === null ? errAsync(new ObjectNotFoundError(key)) : okAsync(object)),
  );
```

- [ ] **Step 6: ルートを足す(チェーンを崩さないこと)**

`buckets` のチェーン末尾に足す。バイナリ面なので戻り型は付かないが、`$url()` は効く。

```ts
  .get('/:bucketId/content/:path{.+}', async (c) => {
    const key = c.req.param('path');

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
            if (object.range === undefined) {
              headers.set('content-length', `${head.size}`);

              return new Response(object.body, { status: 200, headers });
            }
            const start = 'offset' in object.range ? object.range.offset : head.size - (object.range.suffix ?? 0);
            const length = 'length' in object.range && object.range.length !== undefined ? object.range.length : head.size - start;
            headers.set('content-range', `bytes ${start}-${start + length - 1}/${head.size}`);
            headers.set('content-length', `${length}`);

            return new Response(object.body, { status: 206, headers });
          },
          (error) => toErrorResponse(c, error),
        );
      },
      async (error) => toErrorResponse(c, error),
    );
  })
```

- [ ] **Step 7: 統合テストを書く**

```ts
// packages/api/test/content.integration.test.ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

const BODY = 'abcdefghij';

describe('GET /buckets/:bucketId/content/*', () => {
  beforeEach(async () => {
    await env.BUCKET_PHOTOS.put('f.txt', BODY);
  });

  it('Range 無しは 200 で全体', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', {}, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
  });

  it('bytes=2-4 は 206 と Content-Range', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=2-4' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('cde');
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10');
  });

  it('bytes=-3 は末尾 3 バイト', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=-3' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('hij');
  });

  it('bytes=7- は開区間', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=7-' } }, env);

    expect(res.status).toBe(206);
    expect(await res.text()).toBe('hij');
  });

  it('複数レンジは 416', async () => {
    const res = await api.request('/buckets/photos/content/f.txt', { headers: { range: 'bytes=0-1,4-5' } }, env);

    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */10');
  });

  it('存在しないキーは 404', async () => {
    const res = await api.request('/buckets/photos/content/nope.txt', {}, env);

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 8: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): Range 対応のバイナリ配信を追加"
```

---

## Task 9: `packages/api` — 削除

**Files:**
- Create: `packages/api/src/r2/delete.ts`
- Modify: `packages/api/src/buckets/index.ts`
- Create: `packages/api/test/delete.integration.test.ts`

**Interfaces:**
- Consumes: Task 6
- Produces: `DELETE /api/buckets/:bucketId/objects/:path{.+}` → `{ deleted: readonly string[] }`

- [ ] **Step 1: 失敗する統合テストを書く**

```ts
// packages/api/test/delete.integration.test.ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../src/index';

describe('DELETE /buckets/:bucketId/objects/*', () => {
  beforeEach(async () => {
    await env.BUCKET_PHOTOS.put('a.txt', 'a');
    await env.BUCKET_PHOTOS.put('b.txt', 'b');
  });

  it('単一オブジェクトを消す', async () => {
    const res = await api.request('/buckets/photos/objects/a.txt', { method: 'DELETE' }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: ['a.txt'] });
    expect(await env.BUCKET_PHOTOS.head('a.txt')).toBeNull();
    expect(await env.BUCKET_PHOTOS.head('b.txt')).not.toBeNull();
  });

  it('存在しないキーの削除も 200(冪等)', async () => {
    const res = await api.request('/buckets/photos/objects/nope.txt', { method: 'DELETE' }, env);

    expect(res.status).toBe(200);
  });

  it('未登録バケットは 404', async () => {
    const res = await api.request('/buckets/nope/objects/a.txt', { method: 'DELETE' }, env);

    expect(res.status).toBe(404);
  });
});
```

削除を冪等にするのは意図的である。複数選択削除で一部が既に消えていても、UI 側が個別のエラー処理を書かなくて済む。

- [ ] **Step 2: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/test/delete.integration.test.ts`
Expected: FAIL — 404(ルート未定義)

- [ ] **Step 3: 実装を書く**

```ts
// packages/api/src/r2/delete.ts
import { R2OperationError } from '@r2-drive/core';
import { fromPromise } from 'neverthrow';

import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

export const deleteObject = (bucket: R2Bucket, key: string): ResultAsync<readonly string[], DriveError> =>
  fromPromise(bucket.delete(key), (cause) => new R2OperationError(`delete failed: ${key}`, { cause })).map(() => [key]);
```

- [ ] **Step 4: ルートを足す**

`buckets` のチェーン末尾に足す。

```ts
  .delete('/:bucketId/objects/:path{.+}', async (c) => {
    const key = c.req.param('path');

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) => deleteObject(bucket, key).match((deleted) => c.json({ deleted }, 200), (error) => toErrorResponse(c, error)),
      async (error) => toErrorResponse(c, error),
    );
  })
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): オブジェクト削除を追加"
```

---

## Task 10: `packages/api` — multipart アップロード

**Files:**
- Create: `packages/api/src/uploads/index.ts`
- Modify: `packages/api/src/index.ts`
- Create: `packages/api/test/uploads.integration.test.ts`

**Interfaces:**
- Consumes: Task 6
- Produces:
  - `POST /api/uploads/:bucketId` body `{ key: string; contentType: string }` → `{ uploadId: string; key: string }`
  - `PUT /api/uploads/:bucketId/:uploadId/parts/:partNumber?key=` → 200 + `ETag` ヘッダ
  - `POST /api/uploads/:bucketId/:uploadId/complete` body `{ key: string; parts: readonly { partNumber: number; etag: string }[] }` → `{ key: string; etag: string }`
  - `DELETE /api/uploads/:bucketId/:uploadId?key=` → `{ aborted: true }`

- [ ] **Step 1: 失敗する統合テストを書く**

```ts
// packages/api/test/uploads.integration.test.ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

const FIVE_MIB = 5 * 1024 * 1024;
const part = (size: number, fill: string) => new Uint8Array(size).fill(fill.charCodeAt(0));

const create = async (key: string) =>
  (await (
    await api.request('/uploads/photos', { method: 'POST', body: JSON.stringify({ key, contentType: 'text/plain' }), headers: { 'content-type': 'application/json' } }, env)
  ).json()) as { uploadId: string; key: string };

describe('multipart upload', () => {
  it('create → part ×2 → complete でオブジェクトができる', async () => {
    const { uploadId, key } = await create('big.bin');

    const p1 = await api.request(`/uploads/photos/${uploadId}/parts/1?key=${key}`, { method: 'PUT', body: part(FIVE_MIB, 'a') }, env);
    const p2 = await api.request(`/uploads/photos/${uploadId}/parts/2?key=${key}`, { method: 'PUT', body: part(1024, 'b') }, env);

    expect(p1.status).toBe(200);
    expect(p1.headers.get('etag')).toBeTruthy();

    const res = await api.request(
      `/uploads/photos/${uploadId}/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key,
          parts: [
            { partNumber: 1, etag: p1.headers.get('etag') },
            { partNumber: 2, etag: p2.headers.get('etag') },
          ],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const head = await env.BUCKET_PHOTOS.head('big.bin');
    expect(head?.size).toBe(FIVE_MIB + 1024);
  });

  it('abort するとオブジェクトが残らない', async () => {
    const { uploadId, key } = await create('aborted.bin');
    await api.request(`/uploads/photos/${uploadId}/parts/1?key=${key}`, { method: 'PUT', body: part(FIVE_MIB, 'a') }, env);

    const res = await api.request(`/uploads/photos/${uploadId}?key=${key}`, { method: 'DELETE' }, env);

    expect(res.status).toBe(200);
    expect(await env.BUCKET_PHOTOS.head('aborted.bin')).toBeNull();
  });

  it('未知の uploadId は 409 と UploadSessionError', async () => {
    const res = await api.request('/uploads/photos/bogus-upload-id/parts/1?key=x.bin', { method: 'PUT', body: part(16, 'a') }, env);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ name: 'UploadSessionError', reason: 'unknown-upload-id' });
  });

  it('partNumber が 10000 を超えると 409', async () => {
    const { uploadId, key } = await create('x.bin');
    const res = await api.request(`/uploads/photos/${uploadId}/parts/10001?key=${key}`, { method: 'PUT', body: part(16, 'a') }, env);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: 'too-many-parts' });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/test/uploads.integration.test.ts`
Expected: FAIL — 404(ルート未定義)

- [ ] **Step 3: 実装を書く**

```ts
// packages/api/src/uploads/index.ts
import { UploadSessionError } from '@r2-drive/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { fromPromise } from 'neverthrow';
import { z } from 'zod';

import { toErrorResponse } from '../errors/to-error-response';
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
  .post('/:bucketId', zValidator('json', createBody), async (c) => {
    const { key, contentType } = c.req.valid('json');

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) =>
        fromPromise(
          bucket.createMultipartUpload(key, { httpMetadata: { contentType } }),
          (cause) => new UploadSessionError('aborted', { cause }),
        ).match((upload) => c.json({ uploadId: upload.uploadId, key: upload.key }, 200), (error) => toErrorResponse(c, error)),
      async (error) => toErrorResponse(c, error),
    );
  })
  // サーバー側にセッション状態を持たない。uploadId さえあればどのインスタンスからでもパートを受けられる。
  .put('/:bucketId/:uploadId/parts/:partNumber', zValidator('query', keyQuery), async (c) => {
    const partNumber = Number.parseInt(c.req.param('partNumber'), 10);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
      return toErrorResponse(c, new UploadSessionError('too-many-parts'));
    }
    const body = c.req.raw.body;
    if (body === null) return toErrorResponse(c, new UploadSessionError('part-too-small'));

    return resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) => {
        const upload = bucket.resumeMultipartUpload(c.req.valid('query').key, c.req.param('uploadId'));

        return fromPromise(
          upload.uploadPart(partNumber, body),
          (cause) => new UploadSessionError('unknown-upload-id', { cause }),
        ).match(
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

        return fromPromise(
          upload.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))),
          (cause) => new UploadSessionError('unknown-upload-id', { cause }),
        ).match((object) => c.json({ key: object.key, etag: object.httpEtag }, 200), (error) => toErrorResponse(c, error));
      },
      async (error) => toErrorResponse(c, error),
    );
  })
  .delete('/:bucketId/:uploadId', zValidator('query', keyQuery), async (c) =>
    resolveBucket(c.env, c.req.param('bucketId')).match(
      async (bucket) =>
        fromPromise(
          bucket.resumeMultipartUpload(c.req.valid('query').key, c.req.param('uploadId')).abort(),
          (cause) => new UploadSessionError('unknown-upload-id', { cause }),
        ).match(() => c.json({ aborted: true }, 200), (error) => toErrorResponse(c, error)),
      async (error) => toErrorResponse(c, error),
    ),
  );
```

- [ ] **Step 4: `api` にマウントする**

```ts
// packages/api/src/index.ts
export const api = new Hono<HonoEnv>().route('/buckets', buckets).route('/uploads', uploads);
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): R2 multipart アップロードのエンドポイントを追加"
```

---

## Task 11: `packages/api/client` — 型付きクライアント

**Files:**
- Create: `packages/api/src/client.ts`, `packages/api/src/client.test.ts`
- Create: `apps/web/src/api/client.ts`

**Interfaces:**
- Consumes: Task 6, 8, 9, 10
- Produces:
  - `ApiClient` / `hcWithType` / `ApiTransport` / `createApiClient(t: ApiTransport): ApiClient`
  - `request<T>(send: () => Promise<ClientResponse<T>>): ResultAsync<T, DriveError>`
  - `toDriveError(body: ErrorBody): DriveError`

- [ ] **Step 1: 実装を書く**

```ts
// packages/api/src/client.ts
import {
  BucketNotFoundError,
  NetworkError,
  ObjectNotFoundError,
  PreconditionFailedError,
  R2OperationError,
  UnauthenticatedError,
  UploadSessionError,
} from '@r2-drive/core';
import { hc } from 'hono/client';
import { errAsync, fromPromise } from 'neverthrow';

import { api } from './index';

import type { AppType } from './index';
import type { DriveError, ErrorBody } from '@r2-drive/core';
import type { ClientResponse } from 'hono/client';
import type { ResultAsync } from 'neverthrow';

// ルート数が 10 を超えると IDE が目に見えて重くなる。型をコンパイル時に固定する。
export type ApiClient = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): ApiClient => hc<AppType>(...args);

export type ApiTransport =
  | { readonly kind: 'browser'; readonly origin: string }
  | { readonly kind: 'ssr'; readonly origin: string; readonly env: Env; readonly ctx: ExecutionContext; readonly headers: Headers };

const mergeHeaders = (base: Headers, extra: HeadersInit | undefined): Headers => {
  const merged = new Headers(base);
  new Headers(extra).forEach((value, key) => merged.set(key, value));

  return merged;
};

export const createApiClient = (t: ApiTransport): ApiClient => {
  switch (t.kind) {
    case 'browser':
      return hcWithType(t.origin);
    case 'ssr':
      // 同一アイソレート内の関数呼び出し。エッジにもアセットレイヤにも Access にも触れない。
      // 元リクエストのヘッダを引き継がないと自分の認証ミドルウェアに弾かれる。
      return hcWithType(t.origin, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          api.fetch(new Request(input, { ...init, headers: mergeHeaders(t.headers, init?.headers) }), t.env, t.ctx),
      });
    default: {
      const _exhaustive: never = t;
      throw new Error(`unhandled transport: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// instanceof はプロセス境界を越えない。wire の name からクラスを復元する。
export const toDriveError = (body: ErrorBody): DriveError => {
  switch (body.name) {
    case 'BucketNotFoundError':
      return new BucketNotFoundError(body.message);
    case 'ObjectNotFoundError':
      return new ObjectNotFoundError(body.message);
    case 'UnauthenticatedError':
      return new UnauthenticatedError(body.message);
    case 'PreconditionFailedError':
      return new PreconditionFailedError(body.message);
    case 'UploadSessionError':
      return new UploadSessionError(body.reason);
    case 'InternalError':
      return new R2OperationError(body.message);
    default: {
      const _exhaustive: never = body;
      throw new Error(`unhandled error body: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Response → Result の唯一の変換点。他の場所では書かない。
export const request = <T>(send: () => Promise<ClientResponse<T>>): ResultAsync<T, DriveError> =>
  fromPromise(send(), (cause) => new NetworkError('request failed', { cause })).andThen((res) =>
    res.ok
      ? fromPromise(res.json() as Promise<T>, (cause) => new NetworkError('malformed json', { cause }))
      : fromPromise(res.json() as Promise<ErrorBody>, (cause) => new NetworkError('malformed error body', { cause })).andThen((body) =>
          errAsync(toDriveError(body)),
        ),
  );
```

- [ ] **Step 2: テストを書く**

```ts
// packages/api/src/client.test.ts
import { env } from 'cloudflare:test';
import { ObjectNotFoundError, UploadSessionError } from '@r2-drive/core';
import { describe, expect, it } from 'vitest';

import { createApiClient, request, toDriveError } from './client';

describe('toDriveError', () => {
  it('name からクラスを復元する', () => {
    expect(toDriveError({ name: 'ObjectNotFoundError', message: 'a.txt' })).toBeInstanceOf(ObjectNotFoundError);
  });

  it('UploadSessionError は reason を保つ', () => {
    const restored = toDriveError({ name: 'UploadSessionError', message: 'x', reason: 'part-too-small' });

    expect(restored).toBeInstanceOf(UploadSessionError);
    expect((restored as UploadSessionError).reason).toBe('part-too-small');
  });
});

describe('createApiClient (ssr)', () => {
  it('ネットワークを経由せず Hono を直接呼ぶ', async () => {
    await env.BUCKET_PHOTOS.put('a.txt', 'a');
    const client = createApiClient({
      kind: 'ssr',
      origin: 'http://localhost',
      env,
      ctx: { waitUntil: () => undefined, passThroughOnException: () => undefined } as ExecutionContext,
      headers: new Headers(),
    });

    const page = (await request(() => client.buckets[':bucketId'].objects.$get({ param: { bucketId: 'photos' }, query: {} })))._unsafeUnwrap();

    expect(page.objects.map((o) => o.key)).toEqual(['a.txt']);
  });

  it('非 2xx を DriveError に落とす', async () => {
    const client = createApiClient({
      kind: 'ssr',
      origin: 'http://localhost',
      env,
      ctx: { waitUntil: () => undefined, passThroughOnException: () => undefined } as ExecutionContext,
      headers: new Headers(),
    });

    const result = await request(() => client.buckets[':bucketId'].objects.$get({ param: { bucketId: 'nope' }, query: {} }));

    expect(result._unsafeUnwrapErr().name).toBe('BucketNotFoundError');
  });
});
```

- [ ] **Step 3: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run packages/api/src/client.test.ts`
Expected: PASS(4 件)

`res.ok` のナローイングが効かず `page.objects` で型エラーが出る場合は、Task 2 Step 10 の検証 B が実は失敗していたということ。spec §8.5 の B 案に切り替えて報告する。

- [ ] **Step 4: ブラウザ側のクライアントを書く**

```ts
// apps/web/src/api/client.ts
import { createApiClient } from '@r2-drive/api/client';

// 同一オリジン。Access の Cookie が自動で乗る。
export const apiClient = createApiClient({ kind: 'browser', origin: '/' });
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): hc ベースの型付きクライアントと Result 変換点を追加"
```

---

## Task 12: `apps/web` — FileTypePlugin と ObjectAction の registry

**Files:**
- Create: `apps/web/src/plugins/file-type/types.ts`, `.../registry.ts`, `.../registry.test.ts`
- Create: `apps/web/src/plugins/file-type/{markdown,image,video,audio,opaque}/index.ts`
- Create: `apps/web/src/plugins/object-action/types.ts`, `.../registry.ts`, `.../registry.test.ts`
- Create: `apps/web/src/plugins/object-action/{download,copy-path,delete}/index.ts`
- Create: `apps/web/src/components/file-icon/{index.tsx,styles.css.ts,file-icon.test.tsx}`

**Interfaces:**
- Consumes: `createRunner` / `ObjectDescriptor`(Task 3)
- Produces:
  - `resolveFileType(o: ObjectDescriptor): Result<FileTypeMatch, ObjectDescriptor>`
  - `FileTypeMatch = { typeId: string; label: string; Icon: ComponentType<IconProps> }`
  - `resolveActions(selection: ObjectSelection): readonly ActionDescriptor[]`

**Phase 0 では `FileTypeCapability`(`Viewer` / `Editor`)を持たない。** ビューアは Phase 2 で 2 種類以上できた時点で spec §5.3 の形にする。実装が 1 つもない拡張点を作らないという §1 の規律に従う。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// apps/web/src/plugins/file-type/registry.test.ts
import { describe, expect, it } from 'vitest';

import { resolveFileType } from './registry';

import type { ObjectDescriptor } from '@r2-drive/core';

const object = (name: string, contentType: string): ObjectDescriptor => ({
  bucketId: 'photos',
  key: name,
  name,
  contentType,
  size: 1,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'e',
});

describe('resolveFileType', () => {
  it('markdown を拡張子で拾う', () => {
    expect(resolveFileType(object('a.md', 'text/markdown'))._unsafeUnwrap().typeId).toBe('markdown');
  });

  it('contentType が octet-stream でも .md なら markdown', () => {
    expect(resolveFileType(object('a.md', 'application/octet-stream'))._unsafeUnwrap().typeId).toBe('markdown');
  });

  it('image/* を拾う', () => {
    expect(resolveFileType(object('a.png', 'image/png'))._unsafeUnwrap().typeId).toBe('image');
  });

  it('video/* を拾う', () => {
    expect(resolveFileType(object('a.mp4', 'video/mp4'))._unsafeUnwrap().typeId).toBe('video');
  });

  it('audio/* を拾う', () => {
    expect(resolveFileType(object('a.flac', 'audio/flac'))._unsafeUnwrap().typeId).toBe('audio');
  });

  it('未知のものは opaque に落ちる', () => {
    expect(resolveFileType(object('a.bin', 'application/octet-stream'))._unsafeUnwrap().typeId).toBe('opaque');
  });

  it('opaque は常にマッチするので err にならない', () => {
    expect(resolveFileType(object('', ''))?.isOk()).toBe(true);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run apps/web/src/plugins/file-type/registry.test.ts`
Expected: FAIL — `Failed to resolve import "./registry"`

- [ ] **Step 3: 型とプラグインを書く**

```ts
// apps/web/src/plugins/file-type/types.ts
import type { ObjectDescriptor, Processor } from '@r2-drive/core';
import type { ComponentType } from 'react';

export type IconProps = { readonly size: number };

// Phase 2 で capability(Viewer / Editor)を足す。今は実装が 0 個なので作らない。
export type FileTypeMatch = {
  readonly typeId: string;
  readonly label: string;
  readonly Icon: ComponentType<IconProps>;
};

export type FileTypePlugin = Processor<ObjectDescriptor, FileTypeMatch>;
```

```tsx
// apps/web/src/plugins/file-type/markdown/index.tsx
import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

const EXTENSIONS = ['.md', '.mdx', '.markdown'];

export const markdownPlugin: FileTypePlugin = {
  id: 'markdown',
  run: (object) =>
    EXTENSIONS.some((ext) => object.name.toLowerCase().endsWith(ext)) || object.contentType === 'text/markdown'
      ? ok({ typeId: 'markdown', label: 'Markdown', Icon: (props) => <FileIcon {...props} glyph="doc" /> })
      : err(object),
};
```

```tsx
// apps/web/src/plugins/file-type/image/index.tsx
import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

export const imagePlugin: FileTypePlugin = {
  id: 'image',
  run: (object) =>
    object.contentType.startsWith('image/')
      ? ok({ typeId: 'image', label: '画像', Icon: (props) => <FileIcon {...props} glyph="image" /> })
      : err(object),
};
```

```tsx
// apps/web/src/plugins/file-type/video/index.tsx
import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

export const videoPlugin: FileTypePlugin = {
  id: 'video',
  run: (object) =>
    object.contentType.startsWith('video/')
      ? ok({ typeId: 'video', label: '動画', Icon: (props) => <FileIcon {...props} glyph="video" /> })
      : err(object),
};
```

```tsx
// apps/web/src/plugins/file-type/audio/index.tsx
import { err, ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

export const audioPlugin: FileTypePlugin = {
  id: 'audio',
  run: (object) =>
    object.contentType.startsWith('audio/')
      ? ok({ typeId: 'audio', label: '音声', Icon: (props) => <FileIcon {...props} glyph="audio" /> })
      : err(object),
};
```

```tsx
// apps/web/src/plugins/file-type/opaque/index.tsx
import { ok } from 'neverthrow';

import { FileIcon } from '../../../components/file-icon/index';

import type { FileTypePlugin } from '../types';

// 常に ok を返す最終防衛線。未知ファイルの扱いをディスパッチャの if ではなく
// 差し替え可能なプラグインにしておくため。
export const opaquePlugin: FileTypePlugin = {
  id: 'opaque',
  run: () => ok({ typeId: 'opaque', label: 'ファイル', Icon: (props) => <FileIcon {...props} glyph="blank" /> }),
};
```

- [ ] **Step 4: registry を書く**

```ts
// apps/web/src/plugins/file-type/registry.ts
import { createRunner } from '@r2-drive/core';

import { audioPlugin } from './audio/index';
import { imagePlugin } from './image/index';
import { markdownPlugin } from './markdown/index';
import { opaquePlugin } from './opaque/index';
import { videoPlugin } from './video/index';

import type { FileTypePlugin } from './types';

// 順序に意味がある(specific → broad)。opaque は必ず最後。
export const fileTypePlugins = [markdownPlugin, imagePlugin, videoPlugin, audioPlugin, opaquePlugin] as const satisfies readonly FileTypePlugin[];

export const resolveFileType = createRunner(fileTypePlugins);
```

- [ ] **Step 5: `FileIcon` を書く**

```tsx
// apps/web/src/components/file-icon/index.tsx
import * as s from './styles.css';

type Glyph = 'doc' | 'image' | 'video' | 'audio' | 'blank';

type Props = { readonly size: number; readonly glyph: Glyph };

const PATHS = {
  doc: 'M6 2h8l4 4v16H6z',
  image: 'M4 5h16v14H4zm2 10l4-4 3 3 3-3 4 4',
  video: 'M4 5h16v14H4zm6 3l6 4-6 4z',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  blank: 'M6 2h12v20H6z',
} satisfies Record<Glyph, string>;

export const FileIcon = ({ size, glyph }: Props) => (
  <svg className={s.icon} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-glyph={glyph}>
    <path d={PATHS[glyph]} />
  </svg>
);
```

```ts
// apps/web/src/components/file-icon/styles.css.ts
import { css } from '@styled/css';

export const icon = css({ fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', flexShrink: 0 });
```

```tsx
// apps/web/src/components/file-icon/file-icon.test.tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FileIcon } from './index';

describe('FileIcon', () => {
  it('glyph を data 属性で公開する', () => {
    const { container } = render(<FileIcon size={16} glyph="image" />);

    expect(container.querySelector('svg')?.dataset.glyph).toBe('image');
  });

  it('装飾なので aria-hidden', () => {
    const { container } = render(<FileIcon size={16} glyph="doc" />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run apps/web`
Expected: PASS

- [ ] **Step 7: ObjectAction を書く**

```ts
// apps/web/src/plugins/object-action/types.ts
import type { ObjectDescriptor, Processor } from '@r2-drive/core';

export type ObjectSelection = { readonly actionId: string; readonly objects: readonly ObjectDescriptor[] };

export type ActionDescriptor = {
  readonly actionId: string;
  readonly label: string;
  readonly destructive: boolean;
  run(objects: readonly ObjectDescriptor[]): Promise<void>;
};

export type ObjectAction = Processor<ObjectSelection, ActionDescriptor>;
```

```ts
// apps/web/src/plugins/object-action/copy-path/index.ts
import { err, ok } from 'neverthrow';

import type { ObjectAction } from '../types';

export const copyPathAction: ObjectAction = {
  id: 'copy-path',
  run: (selection) =>
    selection.actionId === 'copy-path'
      ? ok({
          actionId: 'copy-path',
          label: 'パスをコピー',
          destructive: false,
          run: async (objects) => navigator.clipboard.writeText(objects.map((o) => o.key).join('\n')),
        })
      : err(selection),
};
```

`download` と `delete` も同じ形で書く。`download` は `apiClient` の `$url()` から URL を組み立て、`delete` は `request()` を通す。**具体的な実装は Task 15 の UI 配線と一緒に確定させる。**

- [ ] **Step 8: registry のテストと実装を書く**

```ts
// apps/web/src/plugins/object-action/registry.test.ts
import { describe, expect, it } from 'vitest';

import { resolveAction } from './registry';

describe('resolveAction', () => {
  it('actionId で対応する記述子を返す', () => {
    expect(resolveAction({ actionId: 'copy-path', objects: [] })._unsafeUnwrap().label).toBe('パスをコピー');
  });

  it('delete は destructive', () => {
    expect(resolveAction({ actionId: 'delete', objects: [] })._unsafeUnwrap().destructive).toBe(true);
  });

  it('未知の actionId は err', () => {
    expect(resolveAction({ actionId: 'nope', objects: [] }).isErr()).toBe(true);
  });
});
```

```ts
// apps/web/src/plugins/object-action/registry.ts
import { createRunner } from '@r2-drive/core';

import { copyPathAction } from './copy-path/index';
import { deleteAction } from './delete/index';
import { downloadAction } from './download/index';

import type { ObjectAction } from './types';

export const objectActions = [downloadAction, copyPathAction, deleteAction] as const satisfies readonly ObjectAction[];

export const resolveAction = createRunner(objectActions);
```

- [ ] **Step 9: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run apps/web`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(web): FileTypePlugin と ObjectAction の registry を追加"
```

---

## Task 13: `apps/web` — 仮想化された一覧 UI

**Files:**
- Create: `apps/web/src/queries/objects.ts`
- Create: `apps/web/src/routes/index.tsx`(バケット一覧に差し替え)
- Create: `apps/web/src/routes/b.$bucketId.$.tsx`, `.../b.$bucketId.$.styles.css.ts`
- Create: `apps/web/src/routes/-components/object-list/{index.tsx,styles.css.ts,object-list.test.tsx}`
- Modify: `apps/web/src/router.tsx`(QueryClient を配線)

**Interfaces:**
- Consumes: Task 11, 12
- Produces: `objectsQuery(client, bucketId, prefix)` — `infiniteQueryOptions`

- [ ] **Step 1: 依存を入れる**

```bash
mise exec -- pnpm --filter web add react-aria-components '@tanstack/react-virtual'
mise exec -- pnpm --filter web add -D '@testing-library/react' '@testing-library/user-event' jsdom
```

`@tanstack/react-virtual` は Uppy 側では使わない。react-aria の `Virtualizer` が内部で使う可能性があるため peer として入れる。**一覧の仮想化は react-aria の `Virtualizer` + `ListLayout` で行い、`@tanstack/react-virtual` を素で被せない。** 選択状態を DOM ではなくコレクションが持つ構造が壊れ、範囲選択と cmd+A が動かなくなる。

- [ ] **Step 2: クエリ定義を書く**

```ts
// apps/web/src/queries/objects.ts
import { request } from '@r2-drive/api/client';
import { infiniteQueryOptions } from '@tanstack/react-query';

import type { ApiClient } from '@r2-drive/api/client';
import type { NextPage, ObjectPage } from '@r2-drive/core';

// queryKey は $url() から作る。パス文字列を二重管理しない。
export const objectsQuery = (client: ApiClient, bucketId: string, prefix: string) => {
  const url = client.buckets[':bucketId'].objects.$url({ param: { bucketId }, query: { prefix } });

  return infiniteQueryOptions({
    queryKey: ['api', url.pathname, url.search] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request<ObjectPage>(() =>
        client.buckets[':bucketId'].objects.$get({ param: { bucketId }, query: { prefix, cursor: pageParam } }),
      ).match(
        (page) => page,
        (error) => {
          throw error;
        },
      ),
    getNextPageParam: (last: ObjectPage) => (last.next.kind === 'more' ? last.next.cursor : undefined),
  });
};

export type { NextPage };
```

`queryFn` は TanStack Query の消費エッジなので、ここで `.match` して throw に落とす。これが `Result` チェーンの終端。

- [ ] **Step 3: 失敗するテストを書く**

```tsx
// apps/web/src/routes/-components/object-list/object-list.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ObjectList } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';

const objects: readonly ObjectDescriptor[] = Array.from({ length: 5 }, (_, i) => ({
  bucketId: 'photos',
  key: `f${i}.txt`,
  name: `f${i}.txt`,
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: `e${i}`,
}));

describe('ObjectList', () => {
  it('オブジェクト名を並べる', () => {
    render(<ObjectList folders={[]} objects={objects} onSelectionChange={vi.fn()} onOpenFolder={vi.fn()} />);

    expect(screen.getByText('f0.txt')).toBeTruthy();
  });

  it('キーボードだけで移動して選択できる', async () => {
    const onSelectionChange = vi.fn();
    render(<ObjectList folders={[]} objects={objects} onSelectionChange={onSelectionChange} onOpenFolder={vi.fn()} />);

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{ArrowDown} ');

    expect(onSelectionChange).toHaveBeenCalled();
  });

  it('shift+ArrowDown で範囲選択が伸びる', async () => {
    const onSelectionChange = vi.fn();
    render(<ObjectList folders={[]} objects={objects} onSelectionChange={onSelectionChange} onOpenFolder={vi.fn()} />);

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown} {Shift>}{ArrowDown}{ArrowDown}{/Shift}');

    const last = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(last.size).toBeGreaterThan(1);
  });

  it('フォルダを Enter で開ける', async () => {
    const onOpenFolder = vi.fn();
    render(
      <ObjectList
        folders={[{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }]}
        objects={[]}
        onSelectionChange={vi.fn()}
        onOpenFolder={onOpenFolder}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onOpenFolder).toHaveBeenCalledWith('docs/');
  });
});
```

- [ ] **Step 4: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run apps/web/src/routes/-components/object-list`
Expected: FAIL — `Failed to resolve import "./index"`

- [ ] **Step 5: 実装を書く**

```tsx
// apps/web/src/routes/-components/object-list/index.tsx
import { GridList, GridListItem, ListLayout, Virtualizer } from 'react-aria-components';

import { resolveFileType } from '../../../plugins/file-type/registry';
import * as s from './styles.css';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';
import type { Selection } from 'react-aria-components';

type Row =
  | { readonly kind: 'folder'; readonly id: string; readonly folder: FolderDescriptor }
  | { readonly kind: 'object'; readonly id: string; readonly object: ObjectDescriptor };

type Props = {
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly onSelectionChange: (keys: Selection) => void;
  readonly onOpenFolder: (prefix: string) => void;
};

const ROW_HEIGHT = 40;

export const ObjectList = ({ folders, objects, onSelectionChange, onOpenFolder }: Props) => {
  const rows: readonly Row[] = [
    ...folders.map((folder): Row => ({ kind: 'folder', id: `d:${folder.prefix}`, folder })),
    ...objects.map((object): Row => ({ kind: 'object', id: `f:${object.key}`, object })),
  ];

  return (
    // 選択状態は DOM ではなくコレクションが持つ。だから画面外の行を含む
    // 範囲選択や cmd+A が壊れない。
    <Virtualizer layout={new ListLayout({ rowHeight: ROW_HEIGHT })}>
      <GridList
        aria-label="オブジェクト一覧"
        className={s.listRoot}
        items={rows}
        selectionMode="multiple"
        onSelectionChange={onSelectionChange}
        onAction={(key) => {
          const row = rows.find((r) => r.id === key);
          if (row?.kind === 'folder') onOpenFolder(row.folder.prefix);
        }}
      >
        {(row) => <ObjectRow row={row} />}
      </GridList>
    </Virtualizer>
  );
};

const ObjectRow = ({ row }: { readonly row: Row }) => {
  switch (row.kind) {
    case 'folder':
      return (
        <GridListItem id={row.id} textValue={row.folder.name} className={s.row} data-kind="folder">
          <span className={s.name}>{row.folder.name}</span>
        </GridListItem>
      );
    case 'object': {
      const match = resolveFileType(row.object).unwrapOr(undefined);

      return (
        <GridListItem id={row.id} textValue={row.object.name} className={s.row} data-kind="object">
          {match !== undefined ? <match.Icon size={16} /> : null}
          <span className={s.name}>{row.object.name}</span>
          <span className={s.size}>{row.object.size}</span>
        </GridListItem>
      );
    }
    default: {
      const _exhaustive: never = row;
      throw new Error(`unhandled row: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
```

```ts
// apps/web/src/routes/-components/object-list/styles.css.ts
import { css } from '@styled/css';

export const listRoot = css({ height: '100%', overflow: 'auto' });

// 状態は data 属性で公開し、CSS セレクタで当てる。条件付き className は書かない。
export const row = css({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto',
  alignItems: 'center',
  gap: '2',
  h: '40px',
  px: '3',
  '&[data-hovered]': { bg: 'bg.hover' },
  '&[data-selected]': { bg: 'accent.subtle' },
  '&[data-focus-visible]': { outline: '2px solid', outlineColor: 'accent.base', outlineOffset: '-2px' },
});

export const name = css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const size = css({ color: 'text.muted', fontVariantNumeric: 'tabular-nums' });
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run apps/web/src/routes/-components/object-list`
Expected: PASS(4 件)

- [ ] **Step 7: ルートを書いて loader で先読みする**

```tsx
// apps/web/src/routes/b.$bucketId.$.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import { objectsQuery } from '../queries/objects';
import { ObjectList } from './-components/object-list/index';
import * as s from './b.$bucketId.$.styles.css';

export const Route = createFileRoute('/b/$bucketId/$')({
  loader: ({ context, params }) =>
    context.queryClient.ensureInfiniteQueryData(objectsQuery(apiClient, params.bucketId, params._splat ?? '')),
  component: RouteComponent,
});

function RouteComponent() {
  const { bucketId, _splat } = Route.useParams();
  const prefix = _splat ?? '';
  const navigate = useNavigate();
  const { data } = useSuspenseInfiniteQuery(objectsQuery(apiClient, bucketId, prefix));

  const folders = data.pages.flatMap((page) => page.folders);
  const objects = data.pages.flatMap((page) => page.objects);

  return (
    <main className={s.pageRoot}>
      <ObjectList
        folders={folders}
        objects={objects}
        onSelectionChange={() => undefined}
        onOpenFolder={(next) => navigate({ to: '/b/$bucketId/$', params: { bucketId, _splat: next } })}
      />
    </main>
  );
}
```

`function` 宣言になっているのは TanStack Router の慣習に合わせたもの。`func-style` に触れる場合はアロー関数の `const RouteComponent = () => ...` に直す。

- [ ] **Step 8: ホバーでプリフェッチする**

`ObjectList` の `GridListItem` に `onHoverStart` を足し、フォルダ行なら `queryClient.prefetchInfiniteQuery(objectsQuery(...))` を呼ぶ。これが受け入れ基準 2 の体感速度を作る。

- [ ] **Step 9: 開発サーバーで確認する**

```bash
mise exec -- pnpm --filter web dev
```

`/b/photos/` を開き、キーボードだけで移動・複数選択・フォルダに潜れること、戻ったときに即座に描画されることを目視で確認する。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(web): 仮想化された一覧 UI とプリフェッチを追加"
```

---

## Task 14: `apps/web` — Uppy によるアップロード

**Files:**
- Create: `apps/web/src/upload/create-uploader.ts`, `apps/web/src/upload/create-uploader.test.ts`
- Create: `apps/web/src/routes/-components/upload-tray/{index.tsx,styles.css.ts,upload-tray.test.tsx}`
- Modify: `apps/web/src/routes/b.$bucketId.$.tsx`

**Interfaces:**
- Consumes: Task 10, 11
- Produces: `createUploader(client, bucketId, prefix): Uppy`

- [ ] **Step 1: 依存を入れる**

```bash
mise exec -- pnpm --filter web add '@uppy/core' '@uppy/aws-s3'
```

UI プラグイン(`@uppy/dashboard`)は入れない。UI は react-aria + panda で自作する。

- [ ] **Step 2: 失敗するテストを書く**

```ts
// apps/web/src/upload/create-uploader.test.ts
import { describe, expect, it } from 'vitest';

import { createUploader, shouldUseMultipart } from './create-uploader';

describe('shouldUseMultipart', () => {
  it('100MB 以下は単発 PUT', () => {
    expect(shouldUseMultipart({ size: 50 * 1024 * 1024 })).toBe(false);
  });

  it('100MB 超は multipart', () => {
    expect(shouldUseMultipart({ size: 200 * 1024 * 1024 })).toBe(true);
  });

  it('サイズ不明は multipart に倒す', () => {
    expect(shouldUseMultipart({ size: null })).toBe(true);
  });
});

describe('createUploader', () => {
  it('prefix を key に前置する', () => {
    const uppy = createUploader({ bucketId: 'photos', prefix: 'docs/' });

    expect(uppy.getState().meta).toMatchObject({ prefix: 'docs/' });
  });
});
```

- [ ] **Step 3: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run apps/web/src/upload`
Expected: FAIL — `Failed to resolve import "./create-uploader"`

- [ ] **Step 4: 実装を書く**

```ts
// apps/web/src/upload/create-uploader.ts
import AwsS3 from '@uppy/aws-s3';
import Uppy from '@uppy/core';

import { apiClient } from '../api/client';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

export const shouldUseMultipart = (file: { readonly size: number | null }): boolean =>
  file.size === null || file.size > MULTIPART_THRESHOLD;

type Options = { readonly bucketId: string; readonly prefix: string };

export const createUploader = ({ bucketId, prefix }: Options): Uppy => {
  const uppy = new Uppy({ meta: { prefix } });

  uppy.use(AwsS3, {
    shouldUseMultipart,

    createMultipartUpload: async (file) => {
      const res = await apiClient.uploads[':bucketId'].$post({
        param: { bucketId },
        json: { key: `${prefix}${file.name}`, contentType: file.type ?? 'application/octet-stream' },
      });

      return res.json();
    },

    // 署名しない。同一オリジンの自前エンドポイントに向けるので CORS が丸ごと消え、
    // Access の Cookie も自動で乗る。
    signPart: async (file, { uploadId, partNumber, key }) => ({
      method: 'PUT',
      url: apiClient.uploads[':bucketId'][':uploadId'].parts[':partNumber']
        .$url({ param: { bucketId, uploadId, partNumber: `${partNumber}` }, query: { key } })
        .toString(),
      headers: {},
    }),

    completeMultipartUpload: async (file, { uploadId, key, parts }) => {
      const res = await apiClient.uploads[':bucketId'][':uploadId'].complete.$post({
        param: { bucketId, uploadId },
        json: { key, parts: parts.map((p) => ({ partNumber: p.PartNumber, etag: p.ETag })) },
      });

      return res.json();
    },

    // 中断時に確実に abort する。サーバー側にゴミを残さない(受け入れ基準 4)。
    abortMultipartUpload: async (file, { uploadId, key }) => {
      await apiClient.uploads[':bucketId'][':uploadId'].$delete({ param: { bucketId, uploadId }, query: { key } });
    },
  });

  return uppy;
};
```

`signPart` が返す URL は `$url()` から組み立てる。パス文字列を手で書く箇所をコードベースから消すため。

- [ ] **Step 5: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run apps/web/src/upload`
Expected: PASS(4 件)

- [ ] **Step 6: 進捗 UI と D&D を書く**

`UploadTray` は `uppy.on('upload-progress' | 'complete' | 'error')` を購読し、進捗を data 属性で表現する。ファイルの投下は react-aria の `useDragAndDrop` の `onRootDrop` で受ける。**オブジェクトの移動は Phase 0 スコープ外**なので、ドロップは OS からのファイル取り込みのみを扱う。

```tsx
// apps/web/src/routes/-components/upload-tray/upload-tray.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UploadTray } from './index';

describe('UploadTray', () => {
  it('進行中のファイルが無ければ何も描かない', () => {
    const { container } = render(<UploadTray items={[]} onCancel={() => undefined} />);

    expect(container.firstChild).toBeNull();
  });

  it('進捗を data 属性で公開する', () => {
    render(<UploadTray items={[{ id: '1', name: 'a.bin', progress: 42, state: 'uploading' }]} onCancel={() => undefined} />);

    expect(screen.getByText('a.bin').closest('[data-state]')?.getAttribute('data-state')).toBe('uploading');
  });

  it('中断ボタンがキーボードで押せる', async () => {
    const { getByRole } = render(<UploadTray items={[{ id: '1', name: 'a.bin', progress: 42, state: 'uploading' }]} onCancel={() => undefined} />);

    expect(getByRole('button', { name: '中断' })).toBeTruthy();
  });
});
```

- [ ] **Step 7: 5GB のアップロードを実機で確認する**

```bash
mkfifo /dev/null 2>/dev/null || true
mkdir -p /tmp/r2-drive-fixtures
dd if=/dev/urandom of=/tmp/r2-drive-fixtures/big.bin bs=1m count=5120
```

`pnpm --filter web dev` でこのファイルを投げ、完了すること・途中でタブを閉じたら `abortMultipartUpload` が呼ばれてオブジェクトが残らないことを確認する。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): Uppy をヘッドレスで使う multipart アップロードを追加"
```

---

## Task 15: `apps/web` — 削除 UI とキーボード操作の仕上げ

**Files:**
- Create: `apps/web/src/routes/-components/delete-dialog/{index.tsx,styles.css.ts,delete-dialog.test.tsx}`
- Modify: `apps/web/src/routes/b.$bucketId.$.tsx`
- Modify: `apps/web/src/plugins/object-action/delete/index.ts`, `.../download/index.ts`

**Interfaces:**
- Consumes: Task 9, 11, 12, 13
- Produces: 選択 → Delete キー / コンテキストメニュー → 確認ダイアログ → 削除 → 楽観的にリストから消える

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// apps/web/src/routes/-components/delete-dialog/delete-dialog.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DeleteDialog } from './index';

describe('DeleteDialog', () => {
  it('対象の件数を出す', () => {
    render(<DeleteDialog names={['a.txt', 'b.txt']} isOpen onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/2 件/)).toBeTruthy();
  });

  it('Escape で閉じる', async () => {
    const onCancel = vi.fn();
    render(<DeleteDialog names={['a.txt']} isOpen onConfirm={vi.fn()} onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalled();
  });

  it('確認ボタンがキーボードで押せる', async () => {
    const onConfirm = vi.fn();
    render(<DeleteDialog names={['a.txt']} isOpen onConfirm={onConfirm} onCancel={vi.fn()} />);

    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `mise exec -- pnpm vitest run apps/web/src/routes/-components/delete-dialog`
Expected: FAIL — `Failed to resolve import "./index"`

- [ ] **Step 3: 実装を書く**

```tsx
// apps/web/src/routes/-components/delete-dialog/index.tsx
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import * as s from './styles.css';

type Props = {
  readonly names: readonly string[];
  readonly isOpen: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export const DeleteDialog = ({ names, isOpen, onConfirm, onCancel }: Props) => (
  <ModalOverlay className={s.overlay} isOpen={isOpen} onOpenChange={(open) => (open ? undefined : onCancel())} isDismissable>
    <Modal className={s.modal}>
      <Dialog className={s.dialog} role="alertdialog">
        <Heading slot="title">{names.length} 件を削除しますか</Heading>
        <ul className={s.list}>
          {names.slice(0, 5).map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <div className={s.actions}>
          <Button onPress={onCancel}>キャンセル</Button>
          <Button className={s.destructive} onPress={onConfirm}>
            削除
          </Button>
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>
);
```

`role="alertdialog"` にするのは破壊的操作だから。`ModalOverlay` が focus trap と Escape を仕様どおり処理するので自前実装しない(ui rules の実現順序 2)。

- [ ] **Step 4: 楽観的更新を書く**

削除ミューテーションは `onMutate` で該当行を `queryClient.setQueryData` から取り除き、`onError` で戻す。`objectsQuery` の `queryKey` を使う。

- [ ] **Step 5: Delete キーを配線する**

`GridList` の `onKeyDown` で `Delete` / `Backspace` を拾い、選択が空でなければダイアログを開く。

- [ ] **Step 6: テストが通ることを確認する**

Run: `mise exec -- pnpm vitest run apps/web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): 確認ダイアログ付きの削除と Delete キー操作を追加"
```

---

## Task 16: 受け入れ基準の検証

**Files:**
- Create: `packages/api/test/large-listing.integration.test.ts`
- Create: `docs/superpowers/reports/2026-XX-XX-phase-0-acceptance.md`(日付は実施日)

**Interfaces:**
- Consumes: Task 1–15
- Produces: 受け入れ基準 6 項目それぞれの合否と証拠

- [ ] **Step 1: 10,000 オブジェクトのページングを検証する**

```ts
// packages/api/test/large-listing.integration.test.ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from '../src/index';

describe('大量オブジェクト', () => {
  it('10,000 件をカーソルで最後まで辿れる', async () => {
    const keys = Array.from({ length: 10_000 }, (_, i) => `bulk/${`${i}`.padStart(5, '0')}.txt`);
    await keys.reduce<Promise<unknown>>(async (prev, key) => {
      await prev;

      return env.BUCKET_MEDIA.put(key, 'x');
    }, Promise.resolve());

    const walk = async (cursor: string | undefined, seen: number): Promise<number> => {
      const query = cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const res = await api.request(`/buckets/media/objects?prefix=bulk%2F${query}`, {}, env);
      const page = await res.json();
      const total = seen + page.objects.length;

      return page.next.kind === 'more' ? walk(page.next.cursor, total) : total;
    };

    expect(await walk(undefined, 0)).toBe(10_000);
  }, 120_000);
});
```

`Promise.all` を使わないのは `.oxlintrc.json` の方針に沿うため。逐次でも 10,000 件は現実的な時間で終わる。

- [ ] **Step 2: 基準 1(スクロール性能)を実測する**

`pnpm --filter web dev` で 10,000 件のフォルダを開き、Chrome DevTools の Performance で 5 秒スクロールして記録する。**判定: dropped frames が 5% 未満。** 超えたら `ListLayout` の `rowHeight` 固定と `estimatedRowHeight` の使い分けを見直す。

- [ ] **Step 3: 基準 2(再訪の即時描画)を確認する**

フォルダに潜って戻る操作を行い、Network タブに新規リクエストが出ないこと(キャッシュヒット)を確認する。

- [ ] **Step 4: 基準 3(キーボードのみ)を確認する**

マウスに触れずに、バケット選択 → フォルダ移動 → 複数選択 → 削除 → 確認ダイアログ操作までを完走する。

- [ ] **Step 5: 基準 4(5GB とゴミ残り)を確認する**

Task 14 Step 7 の 5GB ファイルを投げ、完了を確認。別途、50% 地点でタブを閉じ、`wrangler r2 object list` で未完了の multipart が残っていないことを確認する。

- [ ] **Step 6: 基準 5(Access)を確認する**

```bash
mise exec -- pnpm --filter web exec wrangler deploy
curl -sI https://<workers.dev のホスト>/api/buckets   # 到達しないこと
curl -sI https://<Access 配下のカスタムドメイン>/api/buckets  # 302 でログインに飛ぶこと
```

`wrangler.jsonc` の `workers_dev` が `false` であることを再確認する。

- [ ] **Step 7: 基準 6(境界の lint)を確認する**

```bash
echo "import { api } from '@r2-drive/api';" >> apps/web/src/routes/index.tsx
mise exec -- pnpm lint:oxlint    # エラーになること
git checkout apps/web/src/routes/index.tsx
```

- [ ] **Step 8: レポートを書いて Commit**

6 項目それぞれについて「合格 / 不合格 / 回避策」と証拠(数値・スクリーンショット・コマンド出力)を `docs/superpowers/reports/` に残す。不合格があれば、それが Phase 0 の受け入れを止めるものか Phase 1 に送るものかを明記する。

```bash
git add -A
git commit -m "test: Phase 0 受け入れ基準の検証結果を記録"
```

---

## Self-Review

**1. Spec coverage** — spec の各節に対応するタスク:

| spec | タスク |
|---|---|
| §3 技術選定 / 採用ライブラリ | Task 1, 2(依存導入) |
| §4.1 リクエスト経路 / workers_dev | Task 2, 16 Step 6 |
| §4.2 Worker の合成 | Task 2 |
| §4.3 メディア配信は Worker 経由 | Task 8 |
| §4.4 バケットレジストリ | Task 6 |
| §4.5 分割可能に保つ | Task 5(`exports` 分割), Task 16 Step 7 |
| §5.1 createRunner | Task 3 |
| §5.2 拡張点の一覧 | Task 5(ErrorResponder), 6(ObjectSource), 7(IdentityProvider), 12(FileTypePlugin, ObjectAction) |
| §5.3 FileTypePlugin | Task 12(capability は Phase 2 に送る旨を明記) |
| §5.4 ObjectSource | Task 6 |
| §5.5 MarkdownExtension | Phase 3。Phase 0 では作らない |
| §6.1 optional を作らない | Task 3(`NextPage`), 4(`ErrorBody`), 8(`R2RangeSpec`) |
| §6.2 エラークラスと cause | Task 4 |
| §6.3 findCause | Task 4 |
| §6.4 .match は 1 箇所 | Task 6(`toErrorResponse`), 13(`queryFn`) |
| §7 Identity | Task 7 |
| §8.1 ルート定義の規約 | Task 6, 9, 10 |
| §8.2 API 面 | Task 6, 8, 9, 10 |
| §8.3 型のコンパイル | Task 11 |
| §8.4 トランスポート | Task 11 |
| §8.5 エラーのワイヤ表現 | Task 4(型), 5(registry), 11(復元) |
| §8.6 Response → Result | Task 11 |
| §9.1 Range | Task 8 |
| §9.2 multipart | Task 10, 14 |
| §9.3 上書き防止 | **未カバー** → Task 10 の `createMultipartUpload` は既存キーを黙って上書きする。Phase 0 の受け入れ基準に無く、spec §9.3 は「条件付き書き込みが使える」ことの記述に留まるため、Phase 1 に送る。Task 16 のレポートに明記する |
| §9.4 一覧 UI | Task 13 |
| §9.5 R2 の制約 | Task 6(delimiter), Task 13(フォルダ行) |
| §11 モノレポ | Task 1, 3, 5 |
| §12 テスト方針 | 全タスク |
| §13 受け入れ基準 | Task 16 |

**2. Placeholder scan** — 以下 2 箇所が指示の粒度不足だったので、実行者はここで判断せず**必ず確認を取ること**と明記する:

- Task 12 Step 7 の `download` / `delete` アクション本体 — Task 15 で UI と一緒に確定する旨を記載済み
- Task 15 Step 4–5(楽観的更新と Delete キー配線)— コードブロックが無い。実行時に `objectsQuery` の `queryKey` を使った `setQueryData` を書く。ここだけは実装者の裁量が入るため、レビューを厚くする

**3. Type consistency** — 確認済み:

- `ObjectDescriptor.uploadedAt` は全タスクで `string`(ISO8601)。`Date` は使っていない
- `NextPage` の判別子は `kind`(`'more'` / `'end'`)で Task 3 / 6 / 13 / 16 に一貫
- `ErrorBody.name` の literal は Task 4(定義)/ 5(生成)/ 11(復元)で一致
- `resolveFileType` / `resolveAction` / `resolveObjectSource` / `resolveResponse` は全て `createRunner` の戻り値で、`Result<O, I>` を返す
- `UploadFailureReason` は Task 4 で定義し Task 10 で使用
- `BucketId` は Task 6 で registry から導出。他タスクは `string` で受けている(ルートパラメータは実行時に検証されるため)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-14-r2-drive-phase-0.md`.
