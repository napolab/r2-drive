# Phase 1(オブジェクト索引と検索)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** バケットごとの Durable Object に SQLite の索引を持たせ、一覧を R2 の走査から解放し、ファイル名の全文検索を追加する。

**Architecture:** 1 バケット = 1 Durable Object(`idFromName(bucketId)`)。DO の SQLite に `objects` / `prefixes` / `objects_fts` / `meta` の 4 表を持つ。アップロードと削除の後に DO へ同期 RPC で書き込む。一覧は既存の `ObjectSource` registry の先頭に `indexedSource` を挿し、`bucketDescriptors.indexed` が `true` のバケットだけ担当させる。既存バケットの取り込みは DO の `alarm()` が R2 を 1,000 件ずつ舐める。

**Tech Stack:** Cloudflare Durable Objects (SQLite backend) / `drizzle-orm` の `durable-sqlite` / Hono RPC / neverthrow / vitest + `@cloudflare/vitest-pool-workers`

**Spec:** [`docs/superpowers/specs/2026-08-17-r2-drive-phase-1-design.md`](../specs/2026-08-17-r2-drive-phase-1-design.md)

## Global Constraints

- **追加する binding は `OBJECT_INDEX` の 1 つだけ。** Queue / IMAGES / D1 を追加しない
- **`packages/core` を変更しない。** 新しい抽象(`runAll` など)を作らない
- **`ObjectDescriptor` / `NextPage` / `ObjectPage` のワイヤ型を変更しない**(`packages/core/src/object-descriptor.ts`)。クライアントは無変更で動くこと
- **`drizzle-kit` を導入しない。**マイグレーションファイルも作らない。DDL は手書きの `CREATE TABLE IF NOT EXISTS` を DO の起動時に流す。Drizzle はクエリビルダとしてのみ使う
- **DO のメソッドは method shorthand で書く。**arrow property で書くと RPC で公開されない(`.claude/rules/function-style.md` / spec §5)
- `migrations` の `new_sqlite_classes` に書くのは具象クラス名 `"ObjectIndex"` だけ。中間クラス `SqliteStore` は登録しない
- `@r2-drive/api` を値として import してよいのは `apps/web/src/worker.ts` だけ(oxlint の `no-restricted-imports` が強制)
- **`let` / IIFE / `forEach` / `String()` / `Number()` / `Boolean()` / truthiness チェック(`if (x)`)を使わない**(`.claude/rules/functional-programming.md`, `primitive-coercion.md`)
- optional field を作らない。「A があるときだけ B がある」は 2 つの variant にする
- 各タスクの最後に `pnpm lint && pnpm typecheck && pnpm test` が通ること
- コミットメッセージは日本語 + conventional prefix(`feat:` / `fix:` / `test:` / `docs:` / `chore:`)

---

## File Structure

| ファイル | 責務 |
|---|---|
| `packages/api/src/object-index/key-parts/index.ts` | 純粋関数。`key` → `name` / `parentPrefix` / 祖先 prefix 列 |
| `packages/api/src/object-index/schema.ts` | Drizzle のテーブル定義と、手書き DDL の配列 |
| `packages/api/src/object-index/sqlite-store.ts` | `SqliteStore` 基底クラス。DDL 適用と Drizzle インスタンス保持だけ |
| `packages/api/src/object-index/index.ts` | `ObjectIndex extends SqliteStore`。upsert / remove / list / search / backfill |
| `packages/api/src/object-index/registry.ts` | `resolveObjectIndex(env, bucketId)` → `Result<stub, BucketNotFoundError>` |
| `packages/api/src/object-index/status.ts` | `BackfillStatus` の variant 定義 |
| `packages/api/src/plugins/object-source/indexed/index.ts` | `indexedSource` プラグイン |
| `packages/api/test/worker-entry.ts` | テスト用 Worker エントリ。`ObjectIndex` を export する |

変更するファイル: `packages/api/src/r2/registry.ts`(`indexed` 追加)、`packages/api/src/plugins/object-source/registry.ts`(1 行追加)、`packages/api/src/uploads/index.ts`、`packages/api/src/buckets/index.ts`、`packages/api/vitest.config.ts`、`apps/web/src/worker.ts`、`apps/web/wrangler.jsonc.example`

---

## Task 1: DO のテスト基盤を作り、FTS5 が使えることを確かめる

**これは spec §12 のリスク 1 である。falsy なら Task 6(検索)の設計を組み直す。**

**Files:**
- Create: `packages/api/test/worker-entry.ts`
- Create: `packages/api/test/fts5-availability.test.ts`
- Modify: `packages/api/vitest.config.ts`
- Modify: `apps/web/wrangler.jsonc.example`

**Interfaces:**
- Consumes: なし
- Produces: `packages/api/test/worker-entry.ts` が `ObjectIndex` を named export する。以降の全 DO テストがこのエントリを使う

- [ ] **Step 1: `drizzle-orm` を追加する**

```bash
pnpm --filter @r2-drive/api add drizzle-orm
```

- [ ] **Step 2: 検証用の最小 DO クラスとテスト用 Worker エントリを書く**

`packages/api/test/worker-entry.ts`:

```ts
import { DurableObject } from 'cloudflare:workers';

import { api } from '../src/index';

// vitest-pool-workers が DO を実体化するには、Worker エントリから
// クラスが export されている必要がある。Task 3 でここを本物の ObjectIndex に差し替える。
export class ObjectIndex extends DurableObject<Env> {
  probeFts(): readonly string[] {
    this.ctx.storage.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(name)`);
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, '休暇の写真 vacation-2026.jpg');
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, 'invoice-2026-04.pdf');

    const rows = this.ctx.storage.sql.exec<{ name: string }>(`SELECT name FROM probe_fts WHERE probe_fts MATCH ? ORDER BY rank`, 'vacation').toArray();

    return rows.map((row) => row.name);
  }
}

export default api;
```

- [ ] **Step 3: vitest に DO を教える**

`packages/api/vitest.config.ts` を次のようにする。**`cloudflareTest` のオプション名はインストール済みの `@cloudflare/vitest-pool-workers` の型定義で確認すること。**`main` が受け付けられない場合は `wrangler: { configPath }` 方式に切り替える。

```ts
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './test/worker-entry.ts',
      miniflare: {
        r2Buckets: ['BUCKET_PHOTOS', 'BUCKET_MEDIA'],
        durableObjects: { OBJECT_INDEX: { className: 'ObjectIndex', useSQLite: true } },
        bindings: { ACCESS_TEAM: 'test', ACCESS_AUD: 'test', IDENTITY_PROVIDER: 'static' },
      },
    }),
  ],
  test: {
    name: 'api',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: FTS5 が動くことを主張するテストを書く**

`packages/api/test/fts5-availability.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

// spec §12 のリスク 1。Cloudflare は対応拡張の一覧を D1 と DO で共有して記述しているが、
// DO で明示的に検証した記述は確認できていない。ここで実測して固定する。
it('DO の SQLite で FTS5 の仮想テーブルが作れて MATCH が引ける', async () => {
  const stub = env.OBJECT_INDEX.get(env.OBJECT_INDEX.idFromName('fts-probe'));

  await expect(stub.probeFts()).resolves.toEqual(['休暇の写真 vacation-2026.jpg']);
});
```

- [ ] **Step 5: テストを走らせる**

Run: `pnpm vitest run --project api test/fts5-availability.test.ts`

Expected: **PASS**。落ちた場合は 2 通りある。
- `no such module: fts5` のようなエラー → **FTS5 が使えない。ここで止めて報告する。**Task 6 を `name LIKE ?` ベースに組み替える判断が必要
- binding が無い / DO が実体化できない → 設定の問題。Step 3 のオプション名を型定義で確認して直す

- [ ] **Step 6: `wrangler.jsonc.example` に binding を足す**

`apps/web/wrangler.jsonc.example` の `r2_buckets` の後に追記する:

```jsonc
  // 1 バケット = 1 DO(idFromName(bucketId))。索引の実体はこの中の SQLite。
  "durable_objects": {
    "bindings": [{ "name": "OBJECT_INDEX", "class_name": "ObjectIndex" }],
  },
  // SQLite バックエンドを使うので new_sqlite_classes を指定する。
  // 具象クラスだけを書く。中間クラス(SqliteStore)は登録しない。
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ObjectIndex"] }],
```

- [ ] **Step 7: 検証結果を spec に書き戻す**

`docs/superpowers/specs/2026-08-17-r2-drive-phase-1-design.md` の §12 の表のリスク 1 の行を、
実測結果に置き換える。「確認していない」ではなく「2026-08-17 に実測、DO SQLite で FTS5 は使える」と書く。
`falsy だった場合` の列は残す(将来 Cloudflare 側が変わったときの判断材料になる)。

- [ ] **Step 8: コミット**

```bash
git add packages/api/test/worker-entry.ts packages/api/test/fts5-availability.test.ts packages/api/vitest.config.ts packages/api/package.json apps/web/wrangler.jsonc.example docs/superpowers/specs/2026-08-17-r2-drive-phase-1-design.md pnpm-lock.yaml
git commit -m "test(api): DO のテスト基盤を作り FTS5 が使えることを実測で固定する"
```

---

## Task 2: Drizzle の書き込みが原子的になるかを確かめる

**これは spec §12 のリスク 2 である。** Cloudflare は「`await` を挟まない複数の `sql.exec()` が 1 つの暗黙トランザクションになる」と説明している。Drizzle は `await db.insert(...)` の形なので、この原子性が保たれるかは自明でない。

**Files:**
- Create: `packages/api/test/drizzle-atomicity.test.ts`
- Modify: `packages/api/test/worker-entry.ts`

**Interfaces:**
- Consumes: `ObjectIndex`(Task 1 の暫定クラス)
- Produces: 「Drizzle の書き込みを明示トランザクションで囲う必要があるか」という事実。Task 4 の実装方針がこれで決まる

- [ ] **Step 1: 2 本目の書き込みが必ず失敗するプローブを DO に足す**

`packages/api/test/worker-entry.ts` の `ObjectIndex` にメソッドを追加する:

```ts
  // 1 本目は成功し 2 本目が必ず失敗する書き込みを流し、1 本目が巻き戻るかを見る。
  // 巻き戻れば原子的、残れば原子的でない。
  probeAtomicity(): number {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS probe_a (k TEXT PRIMARY KEY)`);
    this.ctx.storage.sql.exec(`DELETE FROM probe_a`);
    try {
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'first');
      // 存在しない表への INSERT なので必ず失敗する。
      this.ctx.storage.sql.exec(`INSERT INTO probe_missing (k) VALUES (?)`, 'second');
    } catch {
      // 例外は握る。ここで見たいのは probe_a の中身だけ。
    }

    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM probe_a`).one().n;
  }
```

- [ ] **Step 2: 挙動を主張するテストを書く**

`packages/api/test/drizzle-atomicity.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

// spec §12 のリスク 2。await を挟まない sql.exec が 1 トランザクションに束ねられるなら、
// 2 本目が失敗した時点で 1 本目も巻き戻り、行数は 0 になる。
it('await を挟まない連続 sql.exec は失敗時に巻き戻る', async () => {
  const stub = env.OBJECT_INDEX.get(env.OBJECT_INDEX.idFromName('atomicity-probe'));

  await expect(stub.probeAtomicity()).resolves.toBe(0);
});
```

- [ ] **Step 3: テストを走らせて事実を確定させる**

Run: `pnpm vitest run --project api test/drizzle-atomicity.test.ts`

**どちらの結果でも計画は続く。結果に応じて Task 4 の方針が変わる。**

| 結果 | 意味 | Task 4 の方針 |
|---|---|---|
| PASS(0 行) | `await` を挟まない `sql.exec` は原子的 | **書き込み経路は raw `sql.exec` を連続で呼ぶ。**Drizzle は読み取り(list / search)だけに使う |
| FAIL(1 行) | 束ねられていない | **書き込みを明示トランザクションで囲う。**期待値を `1` に直してテストを残し、コメントで理由を書く |

**期待値を書き換えたときは、必ずコメントで「実測の結果こうだった」と残すこと。**テストを通すために期待値を変えたのか、事実がそうだったのかが後から区別できなくなる。

- [ ] **Step 4: 検証結果を spec に書き戻す**

`docs/superpowers/specs/2026-08-17-r2-drive-phase-1-design.md` の §12 のリスク 2 の行を実測結果に置き換える。§4 の「着手前に検証すること」の段落も同様に更新する。

- [ ] **Step 5: コミット**

```bash
git add packages/api/test/worker-entry.ts packages/api/test/drizzle-atomicity.test.ts docs/superpowers/specs/2026-08-17-r2-drive-phase-1-design.md
git commit -m "test(api): DO SQLite の書き込み原子性を実測で固定する"
```

---

## Task 3: `key` の分解を純粋関数にする

**Files:**
- Create: `packages/api/src/object-index/key-parts/index.ts`
- Create: `packages/api/src/object-index/key-parts/key-parts.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  ```ts
  export type KeyParts = { readonly name: string; readonly parentPrefix: string; readonly ancestorPrefixes: readonly string[] };
  export const keyPartsOf: (key: string) => KeyParts;
  ```
  Task 4 の `upsert` がこれを使う。`ancestorPrefixes` は `prefixes` 表に入れる値の列で、**末尾に `/` を含み、浅い順に並ぶ**。

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/src/object-index/key-parts/key-parts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { keyPartsOf } from './index';

describe('keyPartsOf', () => {
  it('ルート直下のキーは parentPrefix が空文字で祖先を持たない', () => {
    expect(keyPartsOf('report.pdf')).toEqual({ name: 'report.pdf', parentPrefix: '', ancestorPrefixes: [] });
  });

  it('1 階層下のキーは自分の親だけを祖先に持つ', () => {
    expect(keyPartsOf('photos/a.jpg')).toEqual({ name: 'a.jpg', parentPrefix: 'photos/', ancestorPrefixes: ['photos/'] });
  });

  it('深いキーは祖先を浅い順に列挙する', () => {
    expect(keyPartsOf('a/b/c/d.txt')).toEqual({
      name: 'd.txt',
      parentPrefix: 'a/b/c/',
      ancestorPrefixes: ['a/', 'a/b/', 'a/b/c/'],
    });
  });

  it('末尾が / のキー(フォルダマーカー)も name が空文字になるだけで壊れない', () => {
    expect(keyPartsOf('a/b/')).toEqual({ name: '', parentPrefix: 'a/b/', ancestorPrefixes: ['a/', 'a/b/'] });
  });

  it('連続するスラッシュを潰さない', () => {
    expect(keyPartsOf('a//b.txt')).toEqual({ name: 'b.txt', parentPrefix: 'a//', ancestorPrefixes: ['a/', 'a//'] });
  });
});
```

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm vitest run --project api src/object-index/key-parts/`
Expected: FAIL(`keyPartsOf` が存在しない)

- [ ] **Step 3: 実装する**

`packages/api/src/object-index/key-parts/index.ts`:

```ts
export type KeyParts = {
  readonly name: string;
  /** 末尾の '/' まで。ルート直下は空文字。 */
  readonly parentPrefix: string;
  /** 末尾 '/' 込みの祖先 prefix を浅い順に並べたもの。prefixes 表に入れる値。 */
  readonly ancestorPrefixes: readonly string[];
};

// 末尾の '/' の位置ごとに切って祖先を作る。reduce で組み立てるので let を使わない。
const ancestorsOf = (parentPrefix: string): readonly string[] =>
  parentPrefix
    .split('/')
    .slice(0, -1)
    .reduce<readonly string[]>((acc, segment) => {
      const previous = acc[acc.length - 1] ?? '';

      return [...acc, `${previous}${segment}/`];
    }, []);

export const keyPartsOf = (key: string): KeyParts => {
  const lastSlash = key.lastIndexOf('/');
  const parentPrefix = lastSlash === -1 ? '' : key.slice(0, lastSlash + 1);

  return { name: key.slice(lastSlash + 1), parentPrefix, ancestorPrefixes: ancestorsOf(parentPrefix) };
};
```

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm vitest run --project api src/object-index/key-parts/`
Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/object-index/key-parts/
git commit -m "feat(api): key を name / parentPrefix / 祖先 prefix に分解する純粋関数を追加する"
```

---

## Task 4: `SqliteStore` 基底と `ObjectIndex` の書き込み

**Files:**
- Create: `packages/api/src/object-index/schema.ts`
- Create: `packages/api/src/object-index/sqlite-store.ts`
- Create: `packages/api/src/object-index/index.ts`
- Create: `packages/api/src/object-index/object-index.test.ts`
- Modify: `packages/api/test/worker-entry.ts`(暫定クラスを本物に差し替える)

**Interfaces:**
- Consumes: `keyPartsOf`(Task 3)
- Produces:
  ```ts
  export class SqliteStore extends DurableObject<Env> { ... }
  export class ObjectIndex extends SqliteStore {
    upsert(object: ObjectDescriptor): void;
    remove(key: string): void;
    count(): number;         // テストと status のため
  }
  ```
  `ObjectDescriptor` は `@r2-drive/core` の既存型。**新しい型を作らない。**

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/src/object-index/object-index.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { ObjectDescriptor } from '@r2-drive/core';

const descriptorOf = (key: string, overrides: Partial<ObjectDescriptor> = {}): ObjectDescriptor => ({
  bucketId: 'photos',
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  contentType: 'application/octet-stream',
  size: 10,
  uploadedAt: '2026-08-17T00:00:00.000Z',
  etag: `"etag-${key}"`,
  ...overrides,
});

// テストごとに別 DO を使う。vitest-pool-workers のストレージ分離はファイル単位なので、
// 同一ファイル内のテスト間で書き込みは巻き戻らない。
const stubFor = (name: string) => env.OBJECT_INDEX.get(env.OBJECT_INDEX.idFromName(name));

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
    await expect(stub.debugRow('a.txt')).resolves.toMatchObject({ size: 999, etag: '"new"' });
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

  it('upsert が祖先 prefix を prefixes 表に入れる', async () => {
    const stub = stubFor('write-prefixes');
    await stub.upsert(descriptorOf('a/b/c.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual(['a/', 'a/b/']);
  });

  it('祖先 prefix は重複しても 1 行のまま', async () => {
    const stub = stubFor('write-prefixes-dedup');
    await stub.upsert(descriptorOf('a/b/c.txt'));
    await stub.upsert(descriptorOf('a/b/d.txt'));

    await expect(stub.debugPrefixes()).resolves.toEqual(['a/', 'a/b/']);
  });
});
```

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm vitest run --project api src/object-index/object-index.test.ts`
Expected: FAIL(`upsert` が存在しない)

- [ ] **Step 3: スキーマを書く**

`packages/api/src/object-index/schema.ts`:

```ts
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// 1 バケット = 1 DO なので bucket_id 列を持たない。
export const objects = sqliteTable(
  'objects',
  {
    key: text('key').primaryKey(),
    name: text('name').notNull(),
    parentPrefix: text('parent_prefix').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
    etag: text('etag').notNull(),
  },
  (table) => [index('objects_by_folder').on(table.parentPrefix, table.key)],
);

export const prefixes = sqliteTable(
  'prefixes',
  {
    prefix: text('prefix').primaryKey(),
    parentPrefix: text('parent_prefix').notNull(),
  },
  (table) => [index('prefixes_by_parent').on(table.parentPrefix)],
);

export const meta = sqliteTable('meta', {
  k: text('k').primaryKey(),
  v: text('v'),
});

// drizzle-kit を入れない方針なので DDL は手書きする(計画の Global Constraints)。
// objects_fts は FTS5 の仮想テーブルであり Drizzle では表現できないため、
// 読み書きとも raw SQL で扱う。
export const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS objects (
     key TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     parent_prefix TEXT NOT NULL,
     content_type TEXT NOT NULL,
     size INTEGER NOT NULL,
     uploaded_at TEXT NOT NULL,
     etag TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS objects_by_folder ON objects (parent_prefix, key)`,
  `CREATE TABLE IF NOT EXISTS prefixes (
     prefix TEXT PRIMARY KEY,
     parent_prefix TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS prefixes_by_parent ON prefixes (parent_prefix)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS objects_fts USING fts5(key, name)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
];
```

- [ ] **Step 4: 基底クラスを書く**

`packages/api/src/object-index/sqlite-store.ts`:

```ts
import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';

import { DDL } from './schema';

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

// 小さい土台。スキーマ適用と Drizzle インスタンスの保持だけを持つ。
// 機能は extends して足す(spec §5)。
//
// メソッドは必ず method shorthand で書くこと。arrow property は prototype ではなく
// インスタンスに乗るため RPC で公開されない。
export class SqliteStore extends DurableObject<Env> {
  protected readonly db: DrizzleSqliteDODatabase<Record<string, never>>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    // 起動時に一度だけ DDL を流す。CREATE ... IF NOT EXISTS なので冪等。
    // blockConcurrencyWhile で、スキーマ適用前のリクエストが入らないようにする。
    ctx.blockConcurrencyWhile(async () => {
      for (const statement of DDL) ctx.storage.sql.exec(statement);
      await Promise.resolve();
    });
  }
}
```

- [ ] **Step 5: `ObjectIndex` の書き込みを実装する**

`packages/api/src/object-index/index.ts`:

```ts
import { keyPartsOf } from './key-parts/index';
import { SqliteStore } from './sqlite-store';

import type { ObjectDescriptor } from '@r2-drive/core';

type ObjectRow = {
  readonly key: string;
  readonly name: string;
  readonly parent_prefix: string;
  readonly content_type: string;
  readonly size: number;
  readonly uploaded_at: string;
  readonly etag: string;
};

export class ObjectIndex extends SqliteStore {
  // 書き込みは raw sql.exec を await を挟まず連続で呼ぶ。
  // Task 2 の実測により、この並びが 1 トランザクションになる。
  // objects / prefixes / objects_fts が同時にコミットされるので、
  // 「FTS だけ書き忘れる」が構造的に起きない(spec §4)。
  upsert(object: ObjectDescriptor): void {
    const { name, parentPrefix, ancestorPrefixes } = keyPartsOf(object.key);
    const sql = this.ctx.storage.sql;

    sql.exec(
      `INSERT INTO objects (key, name, parent_prefix, content_type, size, uploaded_at, etag)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name = excluded.name, parent_prefix = excluded.parent_prefix,
         content_type = excluded.content_type, size = excluded.size,
         uploaded_at = excluded.uploaded_at, etag = excluded.etag`,
      object.key,
      name,
      parentPrefix,
      object.contentType,
      object.size,
      object.uploadedAt,
      object.etag,
    );
    // FTS5 は UPSERT を持たないので、消してから入れる。
    sql.exec(`DELETE FROM objects_fts WHERE key = ?`, object.key);
    sql.exec(`INSERT INTO objects_fts (key, name) VALUES (?, ?)`, object.key, name);
    for (const prefix of ancestorPrefixes) {
      sql.exec(`INSERT INTO prefixes (prefix, parent_prefix) VALUES (?, ?) ON CONFLICT(prefix) DO NOTHING`, prefix, keyPartsOf(prefix.slice(0, -1)).parentPrefix);
    }
  }

  // prefixes 行は消さない。空フォルダを表現しない方針(spec §4)なので、
  // 中身が消えたフォルダは一覧のクエリ側で結果に出ないだけでよい。
  remove(key: string): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`DELETE FROM objects WHERE key = ?`, key);
    sql.exec(`DELETE FROM objects_fts WHERE key = ?`, key);
  }

  count(): number {
    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM objects`).one().n;
  }

  // テスト専用。RPC で読めるようにメソッドとして公開する。
  debugRow(key: string): ObjectRow | undefined {
    return this.ctx.storage.sql.exec<ObjectRow>(`SELECT * FROM objects WHERE key = ?`, key).toArray()[0];
  }

  debugPrefixes(): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ prefix: string }>(`SELECT prefix FROM prefixes ORDER BY prefix`)
      .toArray()
      .map((row) => row.prefix);
  }
}
```

**Task 2 の結果が FAIL(原子的でない)だった場合のみ**、`upsert` と `remove` の本体を
`this.ctx.storage.transactionSync(() => { ... })` で囲う。**囲う理由をコメントに書くこと。**

- [ ] **Step 6: テスト用エントリを本物に差し替える**

`packages/api/test/worker-entry.ts` を次のようにする(Task 1 / 2 の暫定クラスは消す。
ただし `probeFts` / `probeAtomicity` のテストは残すので、それらは `ObjectIndex` の
メソッドとして移すか、テスト自体を削除する。**削除する場合は削除理由をコミットメッセージに書く**):

```ts
import { api } from '../src/index';

export { ObjectIndex } from '../src/object-index/index';

export default api;
```

`probeFts` / `probeAtomicity` は検証済みの事実を固定するテストなので**残す**。
`ObjectIndex` にそのままメソッドとして移し、テストの import 元は変えない。

- [ ] **Step 7: テストが通ることを確認する**

Run: `pnpm vitest run --project api`
Expected: PASS(Task 1 / 2 のテストも引き続き通ること)

- [ ] **Step 8: コミット**

```bash
git add packages/api/src/object-index/ packages/api/test/worker-entry.ts
git commit -m "feat(api): ObjectIndex の書き込み経路を追加する

- SqliteStore(基底)は DDL 適用と Drizzle 保持だけを持ち、ObjectIndex が extends する
- objects / prefixes / objects_fts を await を挟まない sql.exec で同時に更新する
- drizzle-kit は入れず DDL は手書きの CREATE ... IF NOT EXISTS で流す"
```

---

## Task 5: `ObjectIndex` の一覧(keyset pagination)

**Files:**
- Modify: `packages/api/src/object-index/index.ts`
- Modify: `packages/api/src/object-index/object-index.test.ts`

**Interfaces:**
- Consumes: Task 4 の `upsert`
- Produces:
  ```ts
  list(input: { readonly bucketId: string; readonly prefix: string; readonly cursor: string | undefined; readonly limit: number }): ObjectPage;
  ```
  戻り型は `@r2-drive/core` の既存 `ObjectPage`。**ワイヤ型を変えない。**
  `cursor` は「最後に返した key」。`limit` は必須(`packages/api/src/r2/list.ts` の `ListInput` と同じ規約)。

- [ ] **Step 1: 失敗するテストを追加する**

`packages/api/src/object-index/object-index.test.ts` に `describe` を追加する:

```ts
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
  });

  it('返す ObjectDescriptor は渡した bucketId を持つ', async () => {
    const stub = stubFor('list-bucket-id');
    await stub.upsert(descriptorOf('a/1.txt'));

    const page = await stub.list({ bucketId: 'media', prefix: 'a/', cursor: undefined, limit: 10 });

    expect(page.objects[0]?.bucketId).toBe('media');
  });
});
```

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm vitest run --project api src/object-index/object-index.test.ts`
Expected: FAIL(`list` が存在しない)

- [ ] **Step 3: 実装する**

`packages/api/src/object-index/index.ts` に追加する:

```ts
import type { FolderDescriptor, NextPage, ObjectPage } from '@r2-drive/core';

export type IndexListInput = {
  readonly bucketId: string;
  readonly prefix: string;
  readonly cursor: string | undefined;
  readonly limit: number;
};
```

`ObjectIndex` のメソッドとして:

```ts
  // cursor は「最後に返した key」。R2 の opaque token と役割が同じなので
  // ワイヤ型 NextPage は変わらない(spec §6)。
  list(input: IndexListInput): ObjectPage {
    const sql = this.ctx.storage.sql;
    // limit + 1 件取って、余ったら truncated と判定する。COUNT を撃たずに済む。
    const rows =
      input.cursor === undefined
        ? sql.exec<ObjectRow>(`SELECT * FROM objects WHERE parent_prefix = ? ORDER BY key LIMIT ?`, input.prefix, input.limit + 1).toArray()
        : sql.exec<ObjectRow>(`SELECT * FROM objects WHERE parent_prefix = ? AND key > ? ORDER BY key LIMIT ?`, input.prefix, input.cursor, input.limit + 1).toArray();

    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const next: NextPage = rows.length > input.limit && last !== undefined ? { kind: 'more', cursor: last.key } : { kind: 'end' };

    return {
      // フォルダは 1 ページ目だけで出し切る。R2 の delimitedPrefixes も
      // カーソルをまたいで重複しないので、挙動を合わせる。
      folders: input.cursor === undefined ? this.#foldersOf(input.bucketId, input.prefix) : [],
      objects: page.map((row) => ({
        bucketId: input.bucketId,
        key: row.key,
        name: row.name,
        contentType: row.content_type,
        size: row.size,
        uploadedAt: row.uploaded_at,
        etag: row.etag,
      })),
      next,
    };
  }

  #foldersOf(bucketId: string, prefix: string): readonly FolderDescriptor[] {
    return this.ctx.storage.sql
      .exec<{ prefix: string }>(`SELECT prefix FROM prefixes WHERE parent_prefix = ? ORDER BY prefix`, prefix)
      .toArray()
      .map((row) => ({ bucketId, prefix: row.prefix, name: keyPartsOf(row.prefix.slice(0, -1)).name }));
  }
```

**`#foldersOf` は private field 構文にする。**RPC で公開されないようにするため(公開したいのは `list` だけ)。

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm vitest run --project api src/object-index/object-index.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/object-index/
git commit -m "feat(api): ObjectIndex に keyset pagination の一覧を追加する

- cursor は最後に返した key。ワイヤ型 NextPage は変えない
- limit + 1 件取って truncated を判定する(COUNT を撃たない)
- フォルダは 1 ページ目だけで出し切り、R2 の delimitedPrefixes と挙動を合わせる"
```

---

## Task 6: `ObjectIndex` の検索

**Task 1 で FTS5 が使えないと分かった場合は、このタスクを `name LIKE ?` ベースに組み替える。**その場合 `LIKE` パターンは 50 バイト上限があるため、前方一致以外は全走査になることをコメントに残す。

**Files:**
- Modify: `packages/api/src/object-index/index.ts`
- Modify: `packages/api/src/object-index/object-index.test.ts`

**Interfaces:**
- Consumes: Task 4 の `upsert` / `remove`
- Produces:
  ```ts
  search(input: { readonly bucketId: string; readonly query: string; readonly cursor: string | undefined; readonly limit: number }): ObjectPage;
  ```
  `folders` は常に空配列。検索結果に階層構造は無い。

- [ ] **Step 1: 失敗するテストを追加する**

```ts
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

  it('FTS5 の演算子を含む入力で例外を投げない', async () => {
    const stub = stubFor('search-hostile');
    await stub.upsert(descriptorOf('a/1.txt'));

    await expect(stub.search({ bucketId: 'photos', query: 'a OR "b', cursor: undefined, limit: 10 })).resolves.toMatchObject({ folders: [] });
  });
});
```

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm vitest run --project api src/object-index/object-index.test.ts`
Expected: FAIL(`search` が存在しない)

- [ ] **Step 3: 実装する**

```ts
export type IndexSearchInput = {
  readonly bucketId: string;
  readonly query: string;
  readonly cursor: string | undefined;
  readonly limit: number;
};
```

```ts
  // FTS5 のクエリ構文をユーザー入力に露出させない。二重引用符を潰して
  // フレーズとして囲み、末尾に * を付けて前方一致にする。
  // こうしないと 'a OR "b' のような入力が構文エラーで例外になる。
  #ftsQueryOf(raw: string): string {
    const sanitized = raw.replaceAll('"', ' ').trim();

    return sanitized === '' ? '""' : `"${sanitized}"*`;
  }

  // 順序は key 昇順にする。rank 順にすると cursor の意味が壊れる
  // (同じ query でもページ間で順序が安定しない)。
  search(input: IndexSearchInput): ObjectPage {
    const sql = this.ctx.storage.sql;
    const match = this.#ftsQueryOf(input.query);
    const rows =
      input.cursor === undefined
        ? sql
            .exec<ObjectRow>(
              `SELECT o.* FROM objects_fts f JOIN objects o ON o.key = f.key
               WHERE f.objects_fts MATCH ? ORDER BY o.key LIMIT ?`,
              match,
              input.limit + 1,
            )
            .toArray()
        : sql
            .exec<ObjectRow>(
              `SELECT o.* FROM objects_fts f JOIN objects o ON o.key = f.key
               WHERE f.objects_fts MATCH ? AND o.key > ? ORDER BY o.key LIMIT ?`,
              match,
              input.cursor,
              input.limit + 1,
            )
            .toArray();

    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const next: NextPage = rows.length > input.limit && last !== undefined ? { kind: 'more', cursor: last.key } : { kind: 'end' };

    return {
      // 検索結果に階層構造は無い。
      folders: [],
      objects: page.map((row) => ({
        bucketId: input.bucketId,
        key: row.key,
        name: row.name,
        contentType: row.content_type,
        size: row.size,
        uploadedAt: row.uploaded_at,
        etag: row.etag,
      })),
      next,
    };
  }
```

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm vitest run --project api src/object-index/object-index.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/object-index/
git commit -m "feat(api): ObjectIndex に FTS5 の全文検索を追加する

- ユーザー入力を FTS5 の構文に露出させず、フレーズ + 前方一致に正規化する
- 順序は rank ではなく key 昇順。rank 順だと cursor の意味が壊れる
- upsert / remove の後に検索結果が追随することをテストで固定する"
```

---

## Task 7: DO stub の解決と `indexedSource`

**Files:**
- Create: `packages/api/src/object-index/registry.ts`
- Create: `packages/api/src/plugins/object-source/indexed/index.ts`
- Create: `packages/api/src/plugins/object-source/indexed/indexed.test.ts`
- Modify: `packages/api/src/r2/registry.ts`
- Modify: `packages/api/src/plugins/object-source/registry.ts`

**Interfaces:**
- Consumes: `ObjectIndex`(Task 5)
- Produces:
  ```ts
  export const resolveObjectIndex: (env: Env, id: string) => Result<DurableObjectStub<ObjectIndex>, BucketNotFoundError>;
  export const indexedSource: ObjectSource;
  ```
  `bucketDescriptors` の各要素が `readonly indexed: boolean` を持つようになる。

- [ ] **Step 1: `bucketDescriptors` に `indexed` を足す**

`packages/api/src/r2/registry.ts` の `BucketDescriptor` と配列を変更する:

```ts
type BucketDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly binding: keyof Env;
  // 索引を信じるかどうかは deploy 時に決める(Phase 1 spec §6)。
  // Processor.run は同期なので「索引が ready か」を実行時に問い合わせられない。
  // バックフィル完了を status で確認してから true にして deploy する。
  readonly indexed: boolean;
};

export const bucketDescriptors = [
  { id: 'photos', label: '写真', binding: 'BUCKET_PHOTOS', indexed: false },
  { id: 'media', label: 'メディア', binding: 'BUCKET_MEDIA', indexed: false },
] as const satisfies readonly BucketDescriptor[];
```

- [ ] **Step 2: stub の解決を書く**

`packages/api/src/object-index/registry.ts`:

```ts
import { BucketNotFoundError } from '@r2-drive/core';
import { err, ok } from 'neverthrow';

import { bucketDescriptors } from '../r2/registry';

import type { ObjectIndex } from './index';
import type { Result } from 'neverthrow';

// 1 バケット = 1 DO。idFromName に bucketId をそのまま渡すので、
// バケットを足しても DO 側の設定は増えない。
export const resolveObjectIndex = (env: Env, id: string): Result<DurableObjectStub<ObjectIndex>, BucketNotFoundError> => {
  const descriptor = bucketDescriptors.find((d) => d.id === id);
  if (descriptor === undefined) return err(new BucketNotFoundError(id));

  return ok(env.OBJECT_INDEX.get(env.OBJECT_INDEX.idFromName(descriptor.id)));
};

// 索引を担当するバケットかどうか。deploy 時の設定なので同期で判定できる。
export const isIndexed = (id: string): boolean => bucketDescriptors.find((d) => d.id === id)?.indexed === true;
```

- [ ] **Step 3: 失敗するテストを書く**

`packages/api/src/plugins/object-source/indexed/indexed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { indexedSource } from './index';

import type { ListRequest } from '../types';

// プラグインは純粋な run(input) として直接テストする(.claude/rules/tdd.md)。
// env は run の中で触られないので、ディスパッチ判定だけをここで固定する。
const requestFor = (bucketId: string): ListRequest => ({
  env: {} as Env,
  bucketId,
  prefix: '',
  cursor: undefined,
});

describe('indexedSource', () => {
  it('indexed でないバケットは担当しない', () => {
    const result = indexedSource.run(requestFor('photos'));

    expect(result.isErr()).toBe(true);
  });

  it('存在しないバケットも担当しない', () => {
    expect(indexedSource.run(requestFor('nope')).isErr()).toBe(true);
  });

  it('担当しないときは入力をそのまま err に返す(createRunner が次へ渡せる)', () => {
    const input = requestFor('photos');

    expect(indexedSource.run(input)._unsafeUnwrapErr()).toBe(input);
  });
});
```

- [ ] **Step 4: 落ちることを確認する**

Run: `pnpm vitest run --project api src/plugins/object-source/indexed/`
Expected: FAIL(`indexedSource` が存在しない)

- [ ] **Step 5: 実装する**

`packages/api/src/plugins/object-source/indexed/index.ts`:

```ts
import { err, ok, ResultAsync } from 'neverthrow';

import { INDEX_PAGE_SIZE } from '../r2-list/index';
import { isIndexed, resolveObjectIndex } from '../../../object-index/registry';

import type { ObjectSource } from '../types';
import type { DriveError, ObjectPage } from '@r2-drive/core';

// ディスパッチは同期(このバケットを担当するか)、仕事は非同期。
// 担当判定に DO への問い合わせを使わないのが要点(Phase 1 spec §6)。
export const indexedSource: ObjectSource = {
  id: 'indexed',
  run: (input) => {
    if (!isIndexed(input.bucketId)) return err(input);

    return ok(
      resolveObjectIndex(input.env, input.bucketId).asyncAndThen((stub) =>
        ResultAsync.fromPromise<ObjectPage, DriveError>(
          stub.list({ bucketId: input.bucketId, prefix: input.prefix, cursor: input.cursor, limit: INDEX_PAGE_SIZE }),
          (cause) => new R2OperationError(`index list failed: ${input.prefix}`, { cause }),
        ),
      ),
    );
  },
};
```

`R2OperationError` は `@r2-drive/core` から import する。`INDEX_PAGE_SIZE` は
`packages/api/src/plugins/object-source/r2-list/index.ts` の `R2_LIST_PAGE_SIZE` を再利用せず、
**このファイル内に `const INDEX_PAGE_SIZE = 1000;` として定義してコメントを付ける**
(R2 の上限と索引の都合は別物であり、片方を変えたときにもう片方が引きずられないようにする)。
上の import 行はそれに合わせて削除する。

- [ ] **Step 6: registry に 1 行足す**

`packages/api/src/plugins/object-source/registry.ts`:

```ts
import { createRunner } from '@r2-drive/core';

import { indexedSource } from './indexed/index';
import { r2ListSource } from './r2-list/index';

import type { ObjectSource } from './types';

// 順序に意味がある(specific → broad)。フォールバックは必ず最後。
export const objectSources = [indexedSource, r2ListSource] as const satisfies readonly ObjectSource[];

export const resolveObjectSource = createRunner(objectSources);
```

- [ ] **Step 7: 通ることを確認する**

Run: `pnpm vitest run --project api`
Expected: PASS。**既存の `objects.integration.test.ts` が壊れていないこと**
(`indexed: false` なので挙動は変わらないはず。これが Phase 1 spec §13 の受け入れ基準 3 である)

- [ ] **Step 8: コミット**

```bash
git add packages/api/src/object-index/registry.ts packages/api/src/plugins/object-source/ packages/api/src/r2/registry.ts
git commit -m "feat(api): indexedSource を registry の先頭に追加する

- 担当判定は bucketDescriptors.indexed(deploy 時の設定)。DO に問い合わせない
- Processor.run が同期なので、実行時の readiness をディスパッチに使えない
- indexed: false のバケットは Phase 0 と完全に同じ経路を通る"
```

---

## Task 8: アップロードと削除を索引に繋ぐ

**Files:**
- Modify: `packages/api/src/uploads/index.ts`(単発 PUT / multipart complete)
- Modify: `packages/api/src/buckets/index.ts`(delete)
- Modify: `packages/api/test/objects.integration.test.ts` または新規 `packages/api/test/index-sync.integration.test.ts`

**Interfaces:**
- Consumes: `resolveObjectIndex` / `isIndexed`(Task 7)、`ObjectIndex.upsert` / `remove`(Task 4)
- Produces: なし(既存ハンドラの副作用が増えるだけ。**レスポンスの形は変えない**)

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/test/index-sync.integration.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { api } from '../src/index';

// bucketDescriptors.indexed は false なので、この統合テストでは
// 「索引に書かれること」を DO 直読みで確認する(一覧経路はまだ R2)。
const indexOf = (bucketId: string) => env.OBJECT_INDEX.get(env.OBJECT_INDEX.idFromName(bucketId));

it('単発アップロードが索引に行を作る', async () => {
  const res = await api.request('/uploads/photos/single?key=sync%2Fa.txt', { method: 'PUT', body: 'hello', headers: { 'content-type': 'text/plain' } }, env);
  expect(res.status).toBe(200);

  await expect(indexOf('photos').debugRow('sync/a.txt')).resolves.toMatchObject({ name: 'a.txt', parent_prefix: 'sync/', content_type: 'text/plain' });
});

it('multipart complete が索引に行を作る', async () => {
  const created = (await (
    await api.request('/uploads/photos', { method: 'POST', body: JSON.stringify({ key: 'sync/m.txt', contentType: 'text/plain' }), headers: { 'content-type': 'application/json' } }, env)
  ).json()) as { readonly uploadId: string; readonly key: string };
  const part = await api.request(`/uploads/photos/${created.uploadId}/parts/1?key=sync%2Fm.txt`, { method: 'PUT', body: 'hello' }, env);
  const etag = part.headers.get('etag');
  if (etag === null) throw new Error('パートの etag が返らなかった');

  const res = await api.request(
    `/uploads/photos/${created.uploadId}/complete`,
    { method: 'POST', body: JSON.stringify({ key: 'sync/m.txt', parts: [{ partNumber: 1, etag }] }), headers: { 'content-type': 'application/json' } },
    env,
  );
  expect(res.status).toBe(200);

  await expect(indexOf('photos').debugRow('sync/m.txt')).resolves.toMatchObject({ name: 'm.txt', parent_prefix: 'sync/' });
});

it('削除が索引から行を消す', async () => {
  await api.request('/uploads/photos/single?key=sync%2Fb.txt', { method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain' } }, env);
  const res = await api.request('/buckets/photos/objects/sync/b.txt', { method: 'DELETE' }, env);
  expect(res.status).toBe(200);

  await expect(indexOf('photos').debugRow('sync/b.txt')).resolves.toBeUndefined();
});
```

**キーはクエリ文字列では URL エンコードする**(`sync%2Fa.txt`)。既存の
`packages/api/test/uploads.integration.test.ts` と同じ形である。
`api.request(path, init, env)` の第 3 引数に `env` を渡すのも既存テストと同じ。

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm vitest run --project api test/index-sync.integration.test.ts`
Expected: FAIL(索引に行が無い)

- [ ] **Step 3: 索引への書き込みを 1 箇所に切り出す**

`packages/api/src/object-index/registry.ts` に追加する:

```ts
import { ResultAsync } from 'neverthrow';
import { R2OperationError } from '@r2-drive/core';

import type { DriveError, ObjectDescriptor } from '@r2-drive/core';

// indexed かどうかに関わらず書く。索引を後から有効化するとき、
// 「有効化前にアップロードされた分が抜けている」を防ぐため
// (抜けるとバックフィルをやり直す必要が出る)。
export const indexUpsert = (env: Env, object: ObjectDescriptor): ResultAsync<void, DriveError> =>
  resolveObjectIndex(env, object.bucketId).asyncAndThen((stub) =>
    ResultAsync.fromPromise(stub.upsert(object), (cause) => new R2OperationError(`index upsert failed: ${object.key}`, { cause })),
  );

export const indexRemove = (env: Env, bucketId: string, key: string): ResultAsync<void, DriveError> =>
  resolveObjectIndex(env, bucketId).asyncAndThen((stub) =>
    ResultAsync.fromPromise(stub.remove(key), (cause) => new R2OperationError(`index remove failed: ${key}`, { cause })),
  );
```

- [ ] **Step 4: 単発 PUT に繋ぐ**

`packages/api/src/uploads/index.ts` の `.put('/:bucketId/single', ...)` の成功枝を変える。
現在の `(object) => c.json({ key: object.key, etag: object.httpEtag }, 200, { etag: object.httpEtag })` を、
`indexUpsert` を挟む形にする:

```ts
        fromPromise(bucket.put(c.req.valid('query').key, body, { httpMetadata: { contentType } }), (cause) => new R2OperationError('single upload failed', { cause }))
          .andThen((object) => {
            const bucketId = c.req.param('bucketId');
            const { name } = keyPartsOf(object.key);

            return indexUpsert(c.env, {
              bucketId,
              key: object.key,
              name,
              contentType,
              size: object.size,
              uploadedAt: object.uploaded.toISOString(),
              etag: object.httpEtag,
            }).map(() => object);
          })
          .match(
            (object) => c.json({ key: object.key, etag: object.httpEtag }, 200, { etag: object.httpEtag }),
            (error) => toErrorResponse(c, error),
          ),
```

`keyPartsOf` を `../object-index/key-parts/index` から import する。

- [ ] **Step 5: multipart complete と delete にも同じ形で繋ぐ**

- `packages/api/src/uploads/index.ts` の `.post('/:bucketId/:uploadId/complete', ...)` — `upload.complete(...)` の戻り値 `object` から同様に `indexUpsert` を呼ぶ
- `packages/api/src/buckets/index.ts` の `.delete('/:bucketId/objects/:path{.+}', ...)` — R2 の delete が成功した後に `indexRemove(c.env, bucketId, key)` を呼ぶ

**どちらも `.andThen(...)` で繋ぎ、`.match` は 1 箇所のまま保つ**(`.claude/rules` の「`.match` は消費エッジ 1 箇所だけ」)。

- [ ] **Step 6: 通ることを確認する**

Run: `pnpm vitest run --project api`
Expected: PASS(既存の upload / delete のテストも壊れていないこと)

- [ ] **Step 7: コミット**

```bash
git add packages/api/src/object-index/registry.ts packages/api/src/uploads/index.ts packages/api/src/buckets/index.ts packages/api/test/index-sync.integration.test.ts
git commit -m "feat(api): アップロードと削除を索引に同期する

- indexed かどうかに関わらず書く。後から有効化したときの取りこぼしを防ぐため
- 索引書き込みは 1 INSERT なので同期 RPC で足りる
  結果として「アップロードしたのに一覧に出ない」問題が発生しない"
```

---

## Task 9: 検索エンドポイント

**Files:**
- Modify: `packages/api/src/buckets/index.ts`
- Create: `packages/api/test/search.integration.test.ts`

**Interfaces:**
- Consumes: `ObjectIndex.search`(Task 6)、`resolveObjectIndex`(Task 7)
- Produces: `GET /buckets/:bucketId/search?q&cursor` → `ObjectPage`。Hono RPC 経由でクライアントに型が流れる

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/test/search.integration.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { api } from '../src/index';

it('検索が索引から結果を返す', async () => {
  await api.request('/uploads/photos/single?key=s%2Fvacation-2026.jpg', { method: 'PUT', body: 'x', headers: { 'content-type': 'image/jpeg' } }, env);
  await api.request('/uploads/photos/single?key=s%2Finvoice.pdf', { method: 'PUT', body: 'x', headers: { 'content-type': 'application/pdf' } }, env);

  const res = await api.request('/buckets/photos/search?q=vacation', {}, env);
  expect(res.status).toBe(200);

  const page = await res.json();
  expect(page).toMatchObject({ folders: [], next: { kind: 'end' } });
  expect(page.objects.map((o: { key: string }) => o.key)).toEqual(['s/vacation-2026.jpg']);
});

it('q が空文字なら 400 を返す', async () => {
  const res = await api.request('/buckets/photos/search?q=', {}, env);

  expect(res.status).toBe(400);
});

it('存在しないバケットは 404 を返す', async () => {
  const res = await api.request('/buckets/nope/search?q=a', {}, env);

  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm vitest run --project api test/search.integration.test.ts`
Expected: FAIL(404 が返る / ルートが無い)

- [ ] **Step 3: ルートを足す**

`packages/api/src/buckets/index.ts` のメソッドチェーンに追加する。**チェーンを途中で `const` に代入して切らないこと**(Hono RPC の型が積み上がらなくなる)。
`objects` ルートの `listQuery` と同じ書き方に合わせる:

```ts
const searchQuery = z.object({ q: z.string().min(1), cursor: z.string().optional() });
```

```ts
  .get('/:bucketId/search', zValidator('query', searchQuery), async (c) => {
    const { q, cursor } = c.req.valid('query');
    const bucketId = c.req.param('bucketId');

    return resolveObjectIndex(c.env, bucketId)
      .asyncAndThen((stub) =>
        ResultAsync.fromPromise<ObjectPage, DriveError>(
          stub.search({ bucketId, query: q, cursor, limit: SEARCH_PAGE_SIZE }),
          (cause) => new R2OperationError(`index search failed: ${q}`, { cause }),
        ),
      )
      .match(
        (page) => c.json(page, 200),
        (error) => toErrorResponse(c, error),
      );
  })
```

`SEARCH_PAGE_SIZE` は同ファイル内に `const SEARCH_PAGE_SIZE = 100;` として定義し、
**「検索結果は一覧より小さいページで返す。全件を舐める用途ではないため」**とコメントする。

`cursor` は `exactOptionalPropertyTypes: true` の下で `string | undefined` として渡せる形にすること
(`z.string().optional()` の結果をそのまま渡してよい)。

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm vitest run --project api test/search.integration.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/buckets/index.ts packages/api/test/search.integration.test.ts
git commit -m "feat(api): GET /buckets/:id/search を追加する

- 戻りは既存の ObjectPage。folders は常に空(検索結果に階層は無い)
- 検索は一覧より小さいページで返す。全件走査の用途ではない"
```

---

## Task 10: バックフィル(`alarm()`)と運用の口

**Files:**
- Create: `packages/api/src/object-index/status.ts`
- Modify: `packages/api/src/object-index/index.ts`
- Modify: `packages/api/src/object-index/object-index.test.ts`
- Modify: `packages/api/src/buckets/index.ts`
- Create: `packages/api/test/backfill.integration.test.ts`

**Interfaces:**
- Consumes: `ObjectIndex.upsert` / `count`(Task 4)
- Produces:
  ```ts
  export type BackfillStatus =
    | { readonly kind: 'idle' }
    | { readonly kind: 'running'; readonly indexed: number }
    | { readonly kind: 'complete'; readonly indexed: number }
    | { readonly kind: 'failed'; readonly indexed: number; readonly reason: string };

  // ObjectIndex のメソッド
  startBackfill(bucketId: string): BackfillStatus;
  status(): BackfillStatus;
  ```
  エンドポイント: `POST /buckets/:bucketId/index/backfill`(202)、`GET /buckets/:bucketId/index/status`(200)

- [ ] **Step 1: status の variant を書く**

`packages/api/src/object-index/status.ts`:

```ts
// 「running のときだけ進捗がある」ではなく、各状態が自分に必要な情報を持つ。
// optional field を作らない(.claude/rules)。
export type BackfillStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly indexed: number }
  | { readonly kind: 'complete'; readonly indexed: number }
  | { readonly kind: 'failed'; readonly indexed: number; readonly reason: string };
```

- [ ] **Step 2: 失敗するテストを追加する**

`packages/api/src/object-index/object-index.test.ts` に追加する:

```ts
describe('ObjectIndex のバックフィル', () => {
  it('一度も走っていなければ idle', async () => {
    await expect(stubFor('backfill-idle').status()).resolves.toEqual({ kind: 'idle' });
  });

  it('R2 の中身を全部取り込んで complete になる', async () => {
    // R2 に直接置く(アップロード API を経由しないので索引には入っていない)
    for (const key of ['bf/1.txt', 'bf/2.txt', 'bf/a/3.txt']) {
      await env.BUCKET_PHOTOS.put(key, 'x', { httpMetadata: { contentType: 'text/plain' } });
    }
    const stub = stubFor('backfill-run');

    await stub.startBackfill('photos');
    // alarm を明示的に走らせる。vitest-pool-workers の runDurableObjectAlarm を使う。
    await expect.poll(async () => (await stub.status()).kind, { timeout: 20_000 }).toBe('complete');

    await expect(stub.count()).resolves.toBe(3);
  });

  it('途中で止めて再実行すると続きから進んで全件揃う', async () => {
    for (const key of ['bf2/1.txt', 'bf2/2.txt']) {
      await env.BUCKET_PHOTOS.put(key, 'x', { httpMetadata: { contentType: 'text/plain' } });
    }
    const stub = stubFor('backfill-resume');

    await stub.startBackfill('photos');
    await expect.poll(async () => (await stub.status()).kind, { timeout: 20_000 }).toBe('complete');
    const first = await stub.count();

    // 冪等性: もう一度走らせても行が増えない
    await stub.startBackfill('photos');
    await expect.poll(async () => (await stub.status()).kind, { timeout: 20_000 }).toBe('complete');

    await expect(stub.count()).resolves.toBe(first);
  });
});
```

**`expect.poll` で待つ代わりに、`cloudflare:test` の `runDurableObjectAlarm(stub)` で
alarm を同期的に走らせる方が決定的である。**インストール済みの
`@cloudflare/vitest-pool-workers` が `runDurableObjectAlarm` を export しているか型定義で確認し、
あるならそちらを使ってポーリングを消すこと。

- [ ] **Step 3: 落ちることを確認する**

Run: `pnpm vitest run --project api src/object-index/object-index.test.ts`
Expected: FAIL(`startBackfill` が存在しない)

- [ ] **Step 4: 実装する**

`packages/api/src/object-index/index.ts` に追加する。`meta` 表に 3 つのキーを置く:
`backfill_state`(`'running' | 'complete' | 'failed'`)、`backfill_cursor`、`backfill_bucket_id`、`backfill_reason`。

```ts
import { keyPartsOf } from './key-parts/index';

import type { BackfillStatus } from './status';
```

```ts
  // R2 の list の 1 ページ分。R2 側の上限が 1000 なのでそれに合わせる。
  static readonly #BACKFILL_PAGE = 1000;

  #metaGet(k: string): string | undefined {
    return this.ctx.storage.sql.exec<{ v: string | null }>(`SELECT v FROM meta WHERE k = ?`, k).toArray()[0]?.v ?? undefined;
  }

  #metaSet(k: string, v: string | undefined): void {
    this.ctx.storage.sql.exec(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v ?? null);
  }

  status(): BackfillStatus {
    const state = this.#metaGet('backfill_state');
    switch (state) {
      case 'running':
        return { kind: 'running', indexed: this.count() };
      case 'complete':
        return { kind: 'complete', indexed: this.count() };
      case 'failed':
        return { kind: 'failed', indexed: this.count(), reason: this.#metaGet('backfill_reason') ?? 'unknown' };
      default:
        return { kind: 'idle' };
    }
  }

  // 何度呼んでも安全。upsert が冪等なので、途中から再実行しても行は増えない。
  startBackfill(bucketId: string): BackfillStatus {
    this.#metaSet('backfill_bucket_id', bucketId);
    this.#metaSet('backfill_cursor', undefined);
    this.#metaSet('backfill_reason', undefined);
    this.#metaSet('backfill_state', 'running');
    void this.ctx.storage.setAlarm(Date.now());

    return this.status();
  }

  // 1 回の alarm で 1 ページ処理し、続きがあれば次の alarm を予約する。
  // 組み込みのリトライは 6 回で尽きるので、失敗は自分で状態に記録して止める。
  override async alarm(): Promise<void> {
    const bucketId = this.#metaGet('backfill_bucket_id');
    if (bucketId === undefined) return;
    const descriptor = bucketDescriptors.find((d) => d.id === bucketId);
    if (descriptor === undefined) {
      this.#metaSet('backfill_reason', `unknown bucket: ${bucketId}`);
      this.#metaSet('backfill_state', 'failed');

      return;
    }
    const bucket = this.env[descriptor.binding] as R2Bucket | undefined;
    if (bucket === undefined) {
      this.#metaSet('backfill_reason', `binding missing: ${descriptor.binding}`);
      this.#metaSet('backfill_state', 'failed');

      return;
    }

    try {
      const cursor = this.#metaGet('backfill_cursor');
      const listed = await bucket.list({ limit: ObjectIndex.#BACKFILL_PAGE, ...(cursor === undefined ? {} : { cursor }) });
      for (const object of listed.objects) {
        this.upsert({
          bucketId,
          key: object.key,
          name: keyPartsOf(object.key).name,
          contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
          size: object.size,
          uploadedAt: object.uploaded.toISOString(),
          etag: object.httpEtag,
        });
      }
      if (listed.truncated) {
        this.#metaSet('backfill_cursor', listed.cursor);
        void this.ctx.storage.setAlarm(Date.now());

        return;
      }
      this.#metaSet('backfill_cursor', undefined);
      this.#metaSet('backfill_state', 'complete');
    } catch (cause) {
      this.#metaSet('backfill_reason', cause instanceof Error ? cause.message : `${cause}`);
      this.#metaSet('backfill_state', 'failed');
    }
  }
```

`bucketDescriptors` を `../r2/registry` から import する。
**`contentType` は `httpMetadata` から取る。**バックフィルは `include: ['httpMetadata']` を
必要とするが、これは 1 ページ 100 件に丸められる副作用を持つ(Task 16 の計測で判明)。
**バックフィルは速さより網羅性が優先なので、ここでは `include` を付けて 100 件ずつでよい。**
`limit` の値と `include` の有無を実測で確認し、コメントに実際の 1 ページ件数を書き残すこと。

- [ ] **Step 5: 運用の口を足す**

`packages/api/src/buckets/index.ts` のチェーンに 2 本追加する:

```ts
  .post('/:bucketId/index/backfill', async (c) => {
    const bucketId = c.req.param('bucketId');

    return resolveObjectIndex(c.env, bucketId)
      .asyncAndThen((stub) => ResultAsync.fromPromise<BackfillStatus, DriveError>(stub.startBackfill(bucketId), (cause) => new R2OperationError('backfill start failed', { cause })))
      .match(
        (status) => c.json(status, 202),
        (error) => toErrorResponse(c, error),
      );
  })
  .get('/:bucketId/index/status', async (c) =>
    resolveObjectIndex(c.env, c.req.param('bucketId'))
      .asyncAndThen((stub) => ResultAsync.fromPromise<BackfillStatus, DriveError>(stub.status(), (cause) => new R2OperationError('backfill status failed', { cause })))
      .match(
        (status) => c.json(status, 200),
        (error) => toErrorResponse(c, error),
      ),
  )
```

**`/:bucketId/objects/:path{.+}` より前に置くこと。**後ろに置くと `objects` ルートの
splat が `index/status` を飲み込む可能性がある。既存のルート順を読んで安全な位置に入れる。

- [ ] **Step 6: エンドポイントの統合テストを書く**

`packages/api/test/backfill.integration.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

import { api } from '../src/index';

it('status が idle を返す', async () => {
  const res = await api.request('/buckets/media/index/status', {}, env);

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ kind: 'idle' });
});

it('backfill の起動が 202 と status を返す', async () => {
  const res = await api.request('/buckets/media/index/backfill', { method: 'POST' }, env);

  expect(res.status).toBe(202);
  await expect(res.json()).resolves.toMatchObject({ kind: 'running' });
});

it('存在しないバケットは 404', async () => {
  const res = await api.request('/buckets/nope/index/status', {}, env);

  expect(res.status).toBe(404);
});
```

- [ ] **Step 7: 通ることを確認する**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全部 PASS

- [ ] **Step 8: `worker.ts` に DO クラスを再輸出する**

`apps/web/src/worker.ts` の末尾に追加する:

```ts
// Durable Object のクラスは Worker エントリから export されている必要がある。
// このファイルだけが @r2-drive/api を値として import してよいので、再輸出もここで行う。
export { ObjectIndex } from '@r2-drive/api';
```

`packages/api/src/index.ts` に `export { ObjectIndex } from './object-index/index';` を追加する。

- [ ] **Step 9: 全体を確認してコミット**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:browser`

```bash
git add packages/api/src/object-index/ packages/api/src/index.ts packages/api/src/buckets/index.ts packages/api/test/backfill.integration.test.ts apps/web/src/worker.ts
git commit -m "feat(api): alarm によるバックフィルと運用の口を追加する

- 1 回の alarm で 1 ページ処理し、カーソルを meta に置いて次を予約する
- upsert が冪等なので途中で止めて再実行しても行が増えない
- 組み込みリトライは 6 回で尽きるため、失敗は状態に記録して止める
- indexed: true への切り替えは API から行わない。deploy 時の設定である"
```

---

## Task 11: 索引経路を実測して有効化する

**Files:**
- Modify: `packages/api/src/r2/registry.ts`(`indexed: true` に切り替え)
- Modify: `reports/2026-08-17-task-16-perf.md` または新規 `reports/2026-08-17-phase-1-index-perf.md`
- Modify: `docs/tasks.md`

**Interfaces:**
- Consumes: Task 1〜10 のすべて
- Produces: Phase 1 spec §13 の受け入れ基準 1 の数字

- [ ] **Step 1: ローカルに 10,000 件を用意する**

`apps/web/.wrangler/state/v3/r2` を消してから、既存のスクリプトで seed し直す。

```bash
pkill -f vite; rm -rf apps/web/.wrangler/state/v3/r2
pnpm --filter web dev &
sleep 14
node --experimental-strip-types apps/web/scripts/seed-r2.ts --total=10000 --concurrency=20
```

- [ ] **Step 2: `indexed: false` のまま 1 ページ目の時間を測る(基準線)**

```bash
curl -s -o /dev/null -w '%{time_total}\n' "http://localhost:5173/api/buckets/photos/objects?prefix=perf/"
```

3 回測って中央値を記録する。

- [ ] **Step 3: バックフィルを走らせて完了を待つ**

```bash
curl -s -X POST "http://localhost:5173/api/buckets/photos/index/backfill"
# complete になるまで見る
curl -s "http://localhost:5173/api/buckets/photos/index/status"
```

- [ ] **Step 4: `indexed: true` にして dev を再起動する**

`packages/api/src/r2/registry.ts` の `photos` の `indexed` を `true` にする。

- [ ] **Step 5: 索引経路で 1 ページ目の時間を測る**

Step 2 と同じコマンドを 3 回。中央値を記録する。

- [ ] **Step 6: 検索を測る**

```bash
curl -s -o /dev/null -w '%{time_total}\n' "http://localhost:5173/api/buckets/photos/search?q=vacation"
curl -s "http://localhost:5173/api/buckets/photos/search?q=meeting" | head -c 400
```

- [ ] **Step 7: 受け入れ基準を 1 つずつ確認する**

Phase 1 spec §13 の 7 項目を、実際に確認した方法とともに記録する。

1. 索引経路が R2 経路より速い(Step 2 と 5 の数字)
2. 検索が 10,000 件から返る(Step 6)
3. `indexed: false` のバケット(`media`)が Phase 0 と同じ挙動をする
4. 索引を壊しても `indexed: false` なら一覧が出る
5. `upsert` / `remove` の後に検索が追随する(Task 6 のテストで固定済み)
6. バックフィルの再実行で全件揃う(Task 10 のテストで固定済み)
7. `ObjectDescriptor` / `NextPage` のワイヤ型が変わっていない(`git diff main -- packages/core` が空)

- [ ] **Step 8: report を書き、`docs/tasks.md` を更新してコミット**

```bash
pnpm exec oxfmt --write reports/ docs/
git add packages/api/src/r2/registry.ts reports/ docs/tasks.md
git commit -m "perf: 索引経路を実測して photos バケットで有効化する"
```

---

## Self-Review

**1. Spec coverage**

| spec の節 | 対応タスク |
|---|---|
| §3 DO を選ぶ(1 バケット = 1 DO) | Task 1(binding)/ Task 7(`idFromName`) |
| §4 スキーマ 4 表 | Task 4(`schema.ts` / DDL) |
| §4 FTS5 を明示更新 | Task 4(`upsert` / `remove`)/ Task 6(追随をテストで固定) |
| §4 Drizzle 選定 | Task 1(依存追加)/ Task 4(`sqlite-store.ts`) |
| §5 `SqliteStore` → `ObjectIndex` の継承 | Task 4 |
| §5 `worker.ts` からの再輸出 | Task 10 Step 8 |
| §6 書き込み経路(upload / delete) | Task 8 |
| §6 読み取り経路(`indexedSource`) | Task 7 |
| §6 検索エンドポイント | Task 9 |
| §6 readiness を deploy 時の設定に | Task 7 Step 1 |
| §6 ページングのワイヤ互換 | Task 5(`NextPage` をそのまま使う) |
| §7 バックフィル(alarm / 冪等 / 起動と観測) | Task 10 |
| §8 テスト戦略 | 各タスクの TDD ステップ + Task 7 Step 7(回帰) |
| §11 課金 | 実装対象ではない |
| §12 リスク 2 件 | Task 1 / Task 2 |
| §13 受け入れ基準 7 件 | Task 11 Step 7 |

**ギャップとして見つけて埋めたもの**: spec §8 の「索引を意図的に壊した状態で一覧が出ること」は、
決定 4(readiness が deploy 時の設定)により「`indexed: false` なら R2 経路に落ちる」の検証に
変質している。Task 7 Step 7 と Task 11 Step 7 の項目 3 / 4 でこれを見る。

**2. Placeholder scan**

初稿に 2 件の欠陥があり、**どちらも計画側で修正した**(実行者に丸投げしていない)。

- Task 1 Step 7 のファイルパスが誤っていた → 正しいパスに直した
- Task 8 Step 1 の `api.request` のパスが不正だった → 既存テストと同じ URL エンコード形に直し、
  multipart complete 経路のテストも追加した

TBD / TODO / 「適切にエラー処理する」「テストを書く(コード無し)」といった記述は無い。

**実行者の判断に委ねている箇所は 3 つだけで、いずれも「実測しないと決まらない」ものである。**

| 箇所 | 委ねている理由 |
|---|---|
| Task 1 Step 3 の `cloudflareTest` のオプション名 | インストール済みバージョンの型定義で確認する必要がある |
| Task 2 Step 3 の期待値 | **実測結果そのものが成果物**である。書き換えたら理由をコメントに残す |
| Task 10 Step 2 の `runDurableObjectAlarm` の有無 | あればポーリングを消せる。無ければ `expect.poll` のまま |
| Task 10 Step 4 のバックフィル 1 ページの実件数 | `include` 併用時に R2 が丸める件数を実測して書き残す |

**3. Type consistency**

- `keyPartsOf` の戻り型 `KeyParts`(Task 3)を Task 4 の `upsert` と Task 5 の `#foldersOf` が使う。名前一致
- `ObjectRow` は Task 4 で定義し Task 5 / 6 が使う。列名は snake_case のまま(SQLite の実際の列名)
- `IndexListInput`(Task 5)と `IndexSearchInput`(Task 6)はどちらも `bucketId` / `cursor` / `limit` を持つ。`limit` は両方とも必須
- `BackfillStatus`(Task 10)は `status.ts` に置き、`index.ts` と `buckets/index.ts` の両方が import する
- `resolveObjectIndex` / `isIndexed` / `indexUpsert` / `indexRemove` はすべて
  `packages/api/src/object-index/registry.ts` に置く。Task 7 で 2 つ、Task 8 で 2 つ追加する
- `ObjectPage` / `NextPage` / `FolderDescriptor` / `ObjectDescriptor` は `@r2-drive/core` の既存型のまま。**変更しない**
