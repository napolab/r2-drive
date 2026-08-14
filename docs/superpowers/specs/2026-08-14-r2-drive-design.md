# r2-drive 設計仕様

- 日付: 2026-08-14
- リポジトリ: `napolab/r2-drive`(初期コミット時点で空)
- 参照実装: `napolab/www.napochaan.com`(skyline packing / 規約スキル群)、`napolab/y-durableobjects`(Yjs on DO)
- 先行事例: `G4brym/R2-Explorer`(MIT。API 設計の参考。UI は Vue + Quasar のため流用しない)

## 1. 目的とスコープ

Cloudflare R2 のバケットを Google Drive のように扱える Web UI を作る。

**この製品が存在する理由は、既存の R2-Explorer が使いづらいこと**であり、機能パリティではなく以下 4 点の解消が製品の主張である。

| 痛み | 真因 | 解決フェーズ |
|---|---|---|
| 一覧が遅い(毎回フルリスト取り直し) | キャッシュが無い | Phase 0(TanStack Query) |
| 一覧が遅い(数千行を DOM に展開) | 仮想化が無い | Phase 0(react-aria `Virtualizer`) |
| 一覧が遅い(サムネイルが無い) | 派生ファイルの索引が無い | Phase 1(D1) |
| 一覧が遅い(1 フォルダ 1000 件超) | `R2.list()` の構造的限界 | Phase 1(D1) |
| 検索が使い物にならない | `R2.list()` に検索が無い | Phase 1(D1 FTS5)/ Phase 5(意味検索) |
| プレビューが貧弱 | 未実装 | Phase 2 |
| 操作感が悪い(キーボード / 複数選択 / D&D) | 未実装 | Phase 0(react-aria) |

### 設計上の最優先事項

**Open/Closed 原則の徹底。** 機能追加が「プラグインを 1 つ書いて registry に 1 行足す」で完結し、コア側の分岐が増えないこと。この方針は他のあらゆる設計判断に優先する。

ただし OCP の暴走を防ぐため、次の規律を置く。

> **拡張点を作ってよいのは、導入時点で実装が 2 つ以上あるか、名前のついたフェーズで 2 つ目が確定しているときだけ。**

実装が 1 つしかない抽象は、2 つ目が来たときにほぼ確実に形が合わず作り直しになる。抽象は 2 つ目の実装が教える。

### スコープ外(本 spec が扱わない範囲)

- Phase 2 以降の詳細設計。本 spec は **Phase 0 を実装可能な粒度**で、Phase 1 以降は**方針と接続点**のみ記述する。
- オブジェクトの移動 / リネーム / フォルダ作成(R2 にディレクトリは存在せず、copy + delete の模倣になる)。
- ゴミ箱(論理削除)、共有リンク。
- アップロードの中断からの再開(`uploadId` の永続化が必要。Phase 1 以降)。

## 2. フェーズ分割

各フェーズは単体で「使えるもの」になるように切る。

| Phase | 内容 | 解消する痛点 |
|---|---|---|
| **0** | 基盤 + 高速一覧(仮想化・複数選択・キーボード・D&D 取り込み)+ multipart アップロード + 削除 | 一覧①②、操作感 |
| **1** | D1 メタデータ索引 + R2 からのバックフィル + 名前 / 型 / サイズ / 日付での検索・ソート + サムネイル | 一覧③④、検索(実用) |
| **2** | ビューア群(画像 / 動画 Range 再生 / 音楽 / markdown 表示) | プレビュー |
| **3** | markdown WYSIWYG 編集 → のちに `y-durableobjects` で共同編集 | |
| **4** | skyline ギャラリー(仮想化 + 無限スクロール) | |
| **5** | Workers AI で説明文生成 → Vectorize → 意味検索 | 検索(意味) |
| **6** | Rust + Cloudflare Containers による HLS トランスコード | |

Phase 1 の D1 索引だけで検索要求の大半が満たせる可能性がある。**Phase 5 の要否は Phase 1 を使ってから再判断する。**

## 3. 技術選定

| 層 | 選定 | 理由 |
|---|---|---|
| 実行環境 | Cloudflare Workers | R2 binding / DO / Containers / Vectorize が同一プラットフォームに揃う |
| フレームワーク | TanStack Start(Vite + `@cloudflare/vite-plugin`) | 型安全ルーティングと TanStack Query 統合。RSC 系は react-aria が全面クライアントのため不利 |
| API 層 | Hono(同一 Worker 内に同居) | `@hono/cloudflare-access` と `y-durableobjects` が Hono 前提。server function はバイナリも WS も扱えないため、この分割はいずれ発生する |
| データ経路 | Hono RPC (`hc`) に一本化 | server function を使わない。データ層の二重化を構造的に排除 |
| UI | react-aria-components + panda css | 複数選択 / キーボード / D&D / `Virtualizer` を仕様として持つ |
| 認証 | Cloudflare Access | アプリ側に認証実装を持たない |
| ストレージ | R2 binding を複数登録し registry から引く | 実行時に任意バケットを開く必要が無く、資格情報の保管も不要 |
| 状態 | TanStack Query | 一覧のキャッシュ / プリフェッチ / 楽観的更新 |
| エラー | neverthrow + `Error` サブクラス | 既存規約に準拠 |
| テスト | vitest + `@cloudflare/vitest-pool-workers` | 本物の R2 binding 相手に検証できる |
| リポジトリ | pnpm workspaces のモノレポ | Phase 6 の Rust コンテナが確実に別 Worker になる。分割をデプロイ単位の変更に落とす(§11) |
| ツーリング | mise + pnpm + tsgo + oxlint + oxfmt + vitest + husky | `typescript-project-setup` スキルのスタックに準拠 |
| コンテナ | Rust + Cloudflare Containers(Phase 6) | ffmpeg によるトランスコード。`apps/transcoder/` |

### 採用ライブラリと判断

| パッケージ | 用途 | 判断 |
|---|---|---|
| `@hono/cloudflare-access` (MIT, 依存ゼロ) | Access JWT 検証 | **採用。** `iss` / `aud` 配列交差 / RS256 強制 / RFC 7515 §4.1.11 `crit` 拒否 / JWKS キャッシュ / `kid` 未知時の再フェッチ(鍵ローテーション)まで実装済み |
| `@uppy/core` + `@uppy/aws-s3` (MIT) | ブラウザ側 multipart | **ヘッドレス採用。** 差し替え 4 点を自前エンドポイントに向けるため presign 不要。UI は使わず react-aria + panda で自作 |
| `range-parser` | Range ヘッダ解析 | **採用。** `bytes=-S` / `bytes=N-` の仕様準拠を自作すると外す |
| `mime` / `mime-types` | 拡張子 → contentType | **採用。** R2 の `httpMetadata` が空のときのフォールバック |
| `@hono/zod-validator` + `zod` | 入力検証 | **採用。** Hono RPC の入力型はこれ経由で付く |
| `eslint-plugin-neverthrow-must-use` | Result の握り潰し検出 | **採用。** 規約を CI で強制する |
| `masonic` / `@virtuoso.dev/masonry` | masonry 仮想化 | **不採用。**§10 参照 |
| `tapable` / `hookable` / `@poppinss/middleware` | プラグイン機構 | **不採用。**§5.1 参照。ただし Phase 1 の `ObjectHook` で `hookable` を再検討する |
| `r2-explorer` | Drive UI 一式 | **不採用。** UI が Vue + Quasar。worker パッケージは API 設計のリファレンスとして読む |

## 4. 全体アーキテクチャ

### 4.1 リクエスト経路

```
ブラウザ
  ↓ (カスタムドメイン。workers_dev は false)
Cloudflare Access            … 認証をここで完結。未認証は Worker に到達しない
  ↓ Cf-Access-Jwt-Assertion
Worker (単一)
  ├─ cloudflareAccess()      … JWT 署名 / iss / aud を検証
  ├─ identityMiddleware      … Identity に正規化して context に載せる
  ├─ /api/*    → Hono        … JSON API + バイナリ配信 + multipart
  ├─ /editor/* → Hono        … WebSocket(Phase 3。y-durableobjects)
  └─ その他    → TanStack Start SSR
```

`workers_dev` を `false` にすることは**必須**である。Access は Worker の前段にいるだけなので、`*.workers.dev` に直接到達されると素通りする。

### 4.2 Worker の合成

```ts
// src/worker.ts
// env はリクエスト時にしか存在しないため、Access ミドルウェアは env を読める位置で生成する。
// startHandler は TanStack Start が生成する Worker ハンドラ。実際の import 経路は
// walking skeleton の成果物として確定させる(下記)。
const app = new Hono<HonoEnv>();

app.use('*', (c, next) => cloudflareAccess(c.env.ACCESS_TEAM, c.env.ACCESS_AUD)(c, next));
app.use('*', identityMiddleware);
app.route('/api', api);
app.all('*', (c) => startHandler.fetch(c.req.raw, c.env, c.executionCtx));

export default app;
```

**この合成が計画全体で最大の未知数である。** TanStack Start が生成する Worker ハンドラに Hono を前置できるかは実物で確かめるしかない。したがって Phase 0 の最初のタスクは機能実装ではなく、**walking skeleton**(Hono + Start + Access + R2 binding が 1 つの Worker で同居し、`/api/ping` と SSR されたページの両方が返る)を通すこととする。ここが通らなければフレームワーク選定に戻る判断が必要になるため、最初に潰す。

### 4.3 メディア配信は全バイト Worker 経由

R2 のカスタムドメインを立てて直接配信する案は採らない。

1. Access アプリが 2 つになりオリジンも 2 つになる
2. バケット単位の出し分けが URL 構造に漏れる
3. 将来の派生ファイル(HLS セグメント、サムネイル)の解決ロジックを 1 箇所に置けなくなる

Worker のストリーミングパススルーは CPU 時間をほぼ消費しない。

### 4.4 バケットレジストリ

`wrangler.jsonc` に binding を並べ、コード側に `{ id, label, binding }` の配列を 1 つ持つ。ルートは `/b/$bucketId/*path`。バケット追加は「`wrangler.jsonc` に 1 行 + registry に 1 行 + 再デプロイ」。

R2 binding は静的にしか宣言できないため、実行時に任意のバケット名を開くことはできない。これは制約ではなく、資格情報を保管しなくて済むという利点として受け入れる。

### 4.5 Worker を分けない判断(ただし分割可能に保つ)

**Phase 0 では単一 Worker とする。** ブラウザがバイナリ面を直接叩く必要がある(Uppy のパート送信、`<video src>`)ため、API を非公開 Worker にするとブラウザから到達できず、フロント Worker がプロキシする羽目になって service binding の利点が消える。

**分けるべき時**は 3 つある。

1. Worker のスクリプトサイズ上限に当たったとき(React SSR + Hono + エディタが同居する Phase 3 以降で現実的な脅威)
2. Phase 6 のトランスコード基盤(Rust コンテナを持つ Worker)が登場するとき — **これは確定している**
3. API と SSR で独立にデプロイしたくなったとき

したがって **コードは最初からモノレポで分離しておき、分割を「パッケージ境界の張り替え」ではなく「デプロイ単位の変更」に落とす**(§11)。分割時に差し替わるのは `createApiClient` のトランスポート 1 箇所である(§8.4)。

## 5. プラグインアーキテクチャ

### 5.1 共有ディスパッチエンジン

全拡張点がこの 1 ファイルを共有する。参照: `prefix-match-processor` スキル。

```ts
// src/plugins/create-runner.ts
import { err, type Result } from 'neverthrow';

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

**既製パッケージを使わない理由:**

- `tapable` / `hookable` はイベントフック機構(多数のリスナーが副作用を起こす)であって first-match ディスパッチではない。戻り値が `undefined` / throw になり `Result` 規約が壊れる。
- `@poppinss/middleware` はミドルウェアチェーン(全部通る)。
- `react-chain-of-responsibility` は React コンポーネント合成であり別問題。

**registry は明示配列とし、`import.meta.glob` による自動収集は使わない。** 順序に意味がある(specific → broad)ため、ファイルシステムの列挙順に委ねられない。

### 5.2 拡張点の一覧と導入フェーズ

| 拡張点 | 役割 | 導入時の実装数 | フェーズ |
|---|---|---|---|
| `FileTypePlugin` | mime に対する表示 / 編集の担当決定 | 画像・動画・音声・markdown・opaque = 5 | 0 |
| `ObjectAction` | 選択に対する操作 | download / copy-path / delete = 3 | 0 |
| `ObjectSource` | 一覧のデータ供給元 | `r2ListSource`(0)/ `indexedSource`(1) = 2 | 0 |
| `IdentityProvider` | 認証主体の解決 | Access / static = 2 | 0 |
| `PlaybackResolver` | 再生ソースの解決 | raw-range(2)/ hls(6) = 2 | 2 |
| `MarkdownExtension` | markdown 記法の 3 点セット | 多数 | 3 |
| `ObjectHook` | アップロード後処理 | 索引書き込み / サムネイル生成(1)= 2 | 1 |

`ObjectHook` を Phase 0 で作らないのは、フックする実装が 0 個だからである。Phase 1 で索引書き込みとサムネイル生成の 2 つが同時に登場するため、そこで導入する。

### 5.3 `FileTypePlugin`(中核)

```ts
// src/plugins/file-type/types.ts
export type FileTypeCapability =
  | { kind: 'opaque' }
  | { kind: 'view'; Viewer: LazyViewer }
  | { kind: 'view-and-edit'; Viewer: LazyViewer; Editor: LazyEditor };

export type FileTypeMatch = {
  readonly typeId: string;
  readonly Icon: ComponentType<IconProps>;
  readonly capability: FileTypeCapability;
};

export type FileTypePlugin = Processor<ObjectDescriptor, FileTypeMatch>;
```

`Editor?` という optional を作らない。「表示だけ」「表示も編集も」「解釈しない」は 3 つの状態であり、1 つの型に `?` で混ぜない。

消費側は `capability.kind` を `switch` し、`default` で `const _exhaustive: never = capability` を書く。4 つ目の capability を足した瞬間、対応していない画面がすべてコンパイルエラーになる。これが「拡張に開き、修正に閉じる」の実効的な保証である。

```ts
// src/plugins/file-type/registry.ts — 順序に意味がある(specific → broad)
export const fileTypePlugins = [
  markdownPlugin,
  imagePlugin,
  videoPlugin,
  audioPlugin,
  opaquePlugin,   // 常に ok を返す最終防衛線
] as const satisfies readonly FileTypePlugin[];

export const resolveFileType = createRunner(fileTypePlugins);
```

未知ファイルの扱いをディスパッチャの `if` ではなく差し替え可能なプラグインにするため、`opaquePlugin` を末尾に置く。

`Viewer` / `Editor` は `lazy(() => import(...))`。`typeId` と `Icon` だけが eager なので、プラグインが増えても一覧画面の初期バンドルは太らない。

### 5.4 `ObjectSource`

一覧のデータ供給元は Phase 0(R2 直)と Phase 1(D1 索引)で入れ替わる。

```ts
export const objectSources = [
  indexedSource,   // Phase 1。索引済みバケットのみ ok を返す
  r2ListSource,    // 常に ok。索引が無い / 追いついていないバケットの受け皿
] as const satisfies readonly ObjectSource[];
```

索引が壊れてもバックフィル中でも `r2ListSource` に落ちて必ず一覧が出る。索引はあくまで後付けのキャッシュ層であり、**R2 が真実である**という原則を崩さない。

### 5.5 `MarkdownExtension`(Phase 3)

first-match ではなく全部を合成するため `createRunner` を使わない。3 点セットを 1 つの型に束ねる。

```ts
export type MarkdownExtension = {
  readonly id: string;
  readonly node: EditorExtension;      // 編集
  readonly parse: ParserPlugin;        // markdown → doc
  readonly serialize: SerializerRule;  // doc → markdown
};
```

3 つとも非 optional であることが要点。「ノードだけ足してシリアライザを忘れる」が型エラーになり、保存した瞬間に記法が消える事故が構造的に起きない。

スキーマは CommonMark + GFM に厳密に制限する(ProseMirror ドキュメントモデルは markdown より表現力が広く、往復で情報が落ちるため)。拡張はこの型を通してのみ行う。

**未決**: エディタ本体を TipTap(`@tiptap/markdown` は公式・`marked` ベース)にするか Milkdown(remark ベース・プラグイン駆動が設計目標)にするか。Milkdown を選ぶ場合、この `MarkdownExtension` 型はフレームワークが提供するものに置き換わる。Phase 3 開始時に決定する。

## 6. 型モデリング規約

参照スキル: `precise-type-modeling` / `branching-modeled-state-with-switch` / `modeling-errors-as-classes` / `chaining-neverthrow-results`。

### 6.1 optional を作らない

```ts
export type ObjectDescriptor = {
  readonly bucketId: BucketId;
  readonly key: ObjectKey;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly uploadedAt: Date;
  readonly etag: string;
};
```

Phase 1 で索引が入っても `width?` / `height?` / `duration?` を生やさない。それは 3 つの optional ではなく 1 つの状態である。

```ts
// Phase 1 で追加: ObjectDescriptor & { readonly media: MediaFacts }
export type MediaFacts =
  | { kind: 'unindexed' }
  | { kind: 'not-media' }
  | { kind: 'image'; width: number; height: number }
  | { kind: 'video'; width: number; height: number; durationMs: number }
  | { kind: 'audio'; durationMs: number };
```

`unindexed`(まだ知らない)と `not-media`(知った上で無い)を別状態として分ける。optional な `width?` はこの 2 つを潰し、ギャラリーが「プレースホルダを出す」か「非メディアとして弾く」かを判断できなくなる。

### 6.2 エラーはクラス、連鎖は `cause`

```ts
// src/server/errors/index.ts
export class BucketNotFoundError extends Error { override name = 'BucketNotFoundError'; }
export class ObjectNotFoundError extends Error { override name = 'ObjectNotFoundError'; }
export class UnauthenticatedError extends Error { override name = 'UnauthenticatedError'; }
export class PreconditionFailedError extends Error { override name = 'PreconditionFailedError'; }
export class R2OperationError extends Error { override name = 'R2OperationError'; }
export class NetworkError extends Error { override name = 'NetworkError'; }

export class UploadSessionError extends Error {
  override name = 'UploadSessionError';
  constructor(
    readonly reason: 'part-too-small' | 'too-many-parts' | 'unknown-upload-id' | 'aborted',
    options?: { cause?: unknown },
  ) {
    super(`upload session failed: ${reason}`, options);
  }
}

export type DriveError =
  | BucketNotFoundError | ObjectNotFoundError | UnauthenticatedError
  | PreconditionFailedError | UploadSessionError | R2OperationError | NetworkError;
```

**例外なく `cause` で連鎖させる。** 独自の `cause` フィールドは作らず、ES2022 ネイティブの `Error` 第 2 引数を使う。

```ts
const getObject = (bucket: R2Bucket, key: ObjectKey): ResultAsync<R2ObjectBody, DriveError> =>
  fromPromise(bucket.get(key), (cause) => new R2OperationError(`get failed: ${key}`, { cause }))
    .andThen((object) => (object === null ? errAsync(new ObjectNotFoundError(key)) : okAsync(object)));
```

### 6.3 `cause` チェーンの再帰探索

連鎖させる以上、トップレベルの `instanceof` は当たらない。消費エッジでは `findCause` を使う。

```ts
// src/server/errors/find-cause.ts
type ErrorPredicate<T extends Error> = (value: unknown) => value is T;

export const isInstanceOf =
  <T extends Error>(ctor: abstract new (...args: never[]) => T): ErrorPredicate<T> =>
  (value): value is T =>
    value instanceof ctor;

// cause チェーンを根に向かって辿り、最初に一致したものを返す。
// depth は暴走よけ。Error.cause に循環は作れないが、第三者の値が混ざる可能性はある。
export const findCause = <T extends Error>(
  value: unknown,
  matches: ErrorPredicate<T>,
  depth = 32,
): T | undefined => {
  if (matches(value)) return value;
  if (depth <= 0) return undefined;
  if (!(value instanceof Error)) return undefined;
  if (value.cause === undefined) return undefined;

  return findCause(value.cause, matches, depth - 1);
};

// ログ用。チェーンを根まで平坦化する
export const describeCauseChain = (value: unknown, depth = 32): readonly string[] => {
  if (!(value instanceof Error) || depth <= 0) return [String(value)];

  return [`${value.name}: ${value.message}`, ...describeCauseChain(value.cause, depth - 1)];
};
```

`Result` ではなく `T | undefined` を返すのは意図的である。これはパイプライン途中ではなく**消費エッジでの探索**であり、`modeling-errors-as-classes` が示す早期 return チェーンと同じ形に保つため。`Result` を返すとエッジで `isOk()` + `.value` を書くことになり `chaining-neverthrow-results` の禁止事項に触れる。

### 6.4 `.match` は消費エッジ 1 箇所

`server/r2/*` と `server/upload/*` は `ResultAsync<T, DriveError>` を返し続ける。`.match` は Hono のハンドラ、または TanStack Query の `queryFn` でのみ書く。

## 7. Identity

```ts
export type Identity =
  | { kind: 'user';    id: string; email: string; displayName: string; groups: readonly string[] }
  | { kind: 'service'; id: string; commonName: string };

export type IdentityProvider = {
  readonly id: string;
  resolve(request: Request): ResultAsync<Identity, DriveError>;
};

export type IdentityProviderFactory = (env: Env) => IdentityProvider;
```

- Access のサービストークンは `email` も `sub` も持たず `common_name` になるため、最初から 2 系統を吸収する union にする。
- `displayName` は常に存在する。`get-identity` が名前を返さなければ**プロバイダが email にフォールバックする責務を持つ**。呼び出し側が毎回 `?? email` を書く状況を作らない。
- `Promise<Identity | null>` の `null` も廃し、`UnauthenticatedError` にする。

**実装は 2 つ:**

1. `cloudflareAccessIdentity` — `@hono/cloudflare-access` に JWT 検証を委譲し、`identity_nonce` をキャッシュキーに `https://<team>.cloudflareaccess.com/cdn-cgi/access/get-identity` を叩いて `displayName` / `groups` を補完する。
2. `staticIdentity` — `wrangler dev` には Access が居ないため、開発とテストに必須。

**ここでは `createRunner` を使わない。** first-match で `staticIdentity` にフォールバックさせると、本番で Access 検証が落ちたときに開発用 Identity が通る。認証の後段フォールバックは事故であり、`env` を見て排他的に 1 つ選ぶファクトリとする。

## 8. API 設計(Hono RPC)

### 8.1 ルート定義の規約

1. **必ずメソッドチェーンで書く。** 途中で `const` に代入して分割すると型が積み上がらない。
2. **ハンドラは `c.json()` を返す。** `Response` 直返しは戻り型が消える。
3. **入力は `zValidator` を通す。**
4. トップで `.route()` を連結し、`export type AppType = typeof api`。

```ts
export const api = new Hono<HonoEnv>()
  .route('/buckets', buckets)
  .route('/uploads', uploads);

export type AppType = typeof api;
```

### 8.2 API 面

```
GET    /api/buckets
GET    /api/buckets/:bucketId/objects?prefix=&cursor=
DELETE /api/buckets/:bucketId/objects/*
POST   /api/buckets/:bucketId/uploads
POST   /api/buckets/:bucketId/uploads/:uploadId/complete
DELETE /api/buckets/:bucketId/uploads/:uploadId
GET    /api/buckets/:bucketId/content/*                      … バイナリ。Range 対応
PUT    /api/buckets/:bucketId/uploads/:uploadId/parts/:n     … バイナリ。ETag を返す
```

| 面 | RPC |
|---|---|
| JSON(上 6 本) | `$get()` / `$post()` の戻り型まで型付き |
| バイナリ(下 2 本) | 戻り型は無し。**`$url()` による URL 構築のみ型安全** |

バイナリ面も同じチェーンに登録する。これにより `` `/api/buckets/${id}/content/${path}` `` のようなテンプレート文字列がコードベースから消える。

```tsx
const src = client.api.buckets[':bucketId'].content[':path{.+}']
  .$url({ param: { bucketId, path } }).toString();
```

### 8.3 型のコンパイル

ルート数が 10 を超えると IDE が目に見えて重くなるため、最初からこの形で書く。

```ts
// src/server/api/client.ts
export type ApiClient = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): ApiClient => hc<AppType>(...args);
```

### 8.4 トランスポート(SSR での自己サブリクエスト回避)

**Worker が自分の公開ホスト名を `fetch()` してもループバックしない。** エッジに出てアセットレイヤに当たり、さらに Access に弾かれてログイン画面が返る。`www.napochaan.com` の `reports/2026-06-14-og-image-service-binding-fix.md` で実際に踏んだ事故と同じ経路である。

本設計では `hc` の `fetch` オプションに Hono の `app.fetch` を差し込み、ネットワークを一切経由しない。

```ts
export type ApiTransport =
  | { kind: 'browser'; origin: string }
  | { kind: 'ssr'; origin: string; env: Env; ctx: ExecutionContext; headers: Headers };

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
```

**`WORKER_SELF_REFERENCE` service binding が必要になる条件**を明示しておく。

> レンダリング経路の中で、URL を渡すと勝手にグローバル `fetch` する第三者ライブラリを使う瞬間(OG 画像生成の Satori、SSR 中のサムネイル取得など)。

該当が出るまでは `wrangler.jsonc` に追加しない。使わないバインディングは「なぜあるのか分からない設定」になる。

### 8.5 エラーのワイヤ表現

`cause` は JSON を生き残らない。したがって:

- **サーバー側**: `describeCauseChain()` で全チェーンを構造化ログに出す
- **クライアントへ**: `name` と `message` だけ。内側の原因は返さない(R2 のキーやバケット名が漏れる)
- **クライアント側**: `name` からエラークラスを復元するマッパを 1 つ置く。以降ブラウザ内でも `instanceof` / `findCause` が使える

```ts
const toErrorResponse = (c: Context, error: DriveError) => {
  c.var.logger.error(c.req.url, describeCauseChain(error));

  const notFound = findCause(error, isInstanceOf(ObjectNotFoundError));
  if (notFound !== undefined) return c.json({ name: notFound.name, message: notFound.message }, 404);

  const precondition = findCause(error, isInstanceOf(PreconditionFailedError));
  if (precondition !== undefined) return c.json({ name: precondition.name, message: precondition.message }, 412);

  const upload = findCause(error, isInstanceOf(UploadSessionError));
  if (upload !== undefined) return c.json({ name: upload.name, message: upload.message, reason: upload.reason }, 409);

  return c.json({ name: 'InternalError', message: 'internal error' }, 500);
};
```

**優先順位は if の並び順であって、チェーンの深さではない。** 「どのエラーが一番行動可能か」で並べる。`UploadSessionError` に包まれた `ObjectNotFoundError` は 404 を返すべきなので `ObjectNotFoundError` が先に来る。

ステータスは**リテラルで書く**。これにより `hc` 側の `res.status` によるナローイングが効く。

### 8.6 `Response` → `Result` の唯一の変換点

`hc` は非 2xx でも throw せず `Response` を返す。変換関数を 1 つだけ作り、他の場所では書かない。

```ts
const request = <T>(send: () => Promise<ClientResponse<T>>): ResultAsync<T, DriveError> =>
  fromPromise(send(), (cause) => new NetworkError('request failed', { cause }))
    .andThen((res) => (res.ok ? fromPromise(res.json(), toParseError) : parseErrorBody(res)));
```

## 9. Phase 0 の実装仕様

### 9.1 Range 配信

`range-parser` で解析し、R2 の range オプションに変換する。

| Range ヘッダ | R2 |
|---|---|
| `bytes=N-M` | `{ offset: N, length: M - N + 1 }` |
| `bytes=N-` | `{ offset: N }` |
| `bytes=-S` | `{ suffix: S }` |
| 複数レンジ | **非対応。416 を返す** |

複数レンジ(`multipart/byteranges`)を切り捨てるのは、ブラウザの `<video>` / `<audio>` が使わないため。レスポンスは `object.writeHttpMetadata(headers)` でメタデータを埋め、`Accept-Ranges: bytes` と `Content-Range` を付けて 206。

### 9.2 multipart アップロード

**サーバー側にセッション状態を持たない。** R2 の `resumeMultipartUpload(key, uploadId)` があるため、`uploadId` をブラウザに預ければどの Worker インスタンスからでもパートを受けられる。Durable Object も KV も不要。

- パートは 5MiB 以上(最終パートのみ例外)、最大 10,000 パート
- Uppy の `shouldUseMultipart` を「100MB 超なら multipart」とし、それ以下は単発 PUT
- `signPart` は署名せず、`$url()` で組み立てた自前エンドポイントの URL を返す
- Worker は `uploadPart()` が返す etag を `ETag` ヘッダに載せる。Uppy がそれを集めて complete に渡す

**同一オリジンであることが効く。** presigned URL 方式ならクロスオリジンになり、CORS 設定と `Access-Control-Expose-Headers: ETag` が必要になる(定番のハマりどころ)。自前エンドポイントなら CORS が丸ごと消え、Access の Cookie も自動で乗る。

### 9.3 既存ファイルの上書き防止

R2 の条件付き書き込み `put(key, body, { onlyIf: { etagDoesNotMatch: '*' } })` を使う。追加インフラは不要。同じ仕組みが Phase 3 の markdown 楽観ロック(`etagMatches`)にも使える。

### 9.4 一覧 UI

- **データ**: TanStack Query の `useInfiniteQuery`。R2 の `cursor` をそのまま `pageParam` に流す
- **描画**: react-aria の `Virtualizer` + `ListLayout` + `GridList`(`selectionMode="multiple"`)
- **行**: `ObjectDescriptor` → `resolveFileType()` でアイコンを引く
- **D&D**: `useDragAndDrop` の `onRootDrop` で OS からのファイル投下を受ける(**オブジェクトの移動はスコープ外**)
- **体感速度**: 行のホバー / フォーカスでそのフォルダの中身を `prefetchInfiniteQuery`

仮想化と複数選択を react-aria 側で揃えることが要点である。選択状態を DOM ではなくコレクションで持つため、画面外の行を含む範囲選択や cmd+A が壊れない。`@tanstack/react-virtual` を素で使うとここを自前で埋めることになる。

### 9.5 R2 の性質に由来する制約(UI に明示する)

- **ディレクトリは存在しない。** フォルダは `list({ prefix, delimiter: '/' })` が返す `delimitedPrefixes` の集計結果でしかない
- **空のフォルダは表現できない。** Phase 0 ではフォルダ作成を提供しない
- **リネーム / 移動という操作が無い。** copy + delete の模倣になるためスコープ外

## 10. skyline ギャラリーを自作する判断(Phase 4)

`masonic`(MIT、最終更新 2025-04)と `@virtuoso.dev/masonry`(MIT、活発)を評価し、**どちらも採用しない**。

両者は「**高さが未知**の要素を DOM で測って詰める」問題を解いている。そのためスクロール中に再配置が起き(Virtuoso は README で明言)、SSR で位置を確定できない。

本プロジェクトでは Phase 1 の D1 索引が width / height を持つため、**アスペクト比が既知 → 測定なしで幾何が確定する**。この前提では:

- `www.napochaan.com` の `pack()`(cw 単位の skyline パッキング、約 40 行、テスト済み)がそのまま使える
- **横長画像の 2 列 span が表現できる**(両ライブラリとも非対応)
- 仮想化は placements を `y` でソートして二分探索するだけ(約 20 行)

ライブラリは「持っていない情報を推測する」ためにコストを払っているが、こちらはその情報を持っている。使うと機能が減って重くなる。

**ただしトレードオフが 1 つある。** 現行の `pack()` は 2/3/4 列の 3 レイアウトを CSS 変数で吐き、ブレークポイントに CSS だけで選ばせている(完全 SSR・計測ゼロ)。仮想化するには「今どの列数か」を JS が知る必要があり、コンテナ幅の計測 → クライアントコンポーネント化が避けられない。**SSR 純度と仮想化はここで交換になる。** Phase 4 の設計時に判断する。

## 11. モノレポ構成

### 11.1 方針

**分割を後から可能にするのではなく、最初からパッケージ境界として存在させ、デプロイ単位だけを後で変える。** Phase 6 の Rust コンテナは確実に別 Worker になるため、この境界は投機ではなく確定した要件である。

pnpm workspaces を使う。ビルドツール(turbo / nx)は入れない — パッケージ数が一桁のうちは `pnpm -r` で足り、入れると「なぜあるのか分からない設定」が増える。

### 11.2 構成

```
r2-drive/
├─ mise.toml                      … node / pnpm のピン
├─ pnpm-workspace.yaml            … packages 定義 + catalog
├─ tsconfig.base.json
├─ apps/
│  └─ web/                        … Phase 0 で唯一デプロイされる Worker
│     ├─ wrangler.jsonc           … R2 binding 群 / workers_dev: false
│     ├─ panda.config.ts
│     └─ src/
│        ├─ worker.ts             … Hono + Start の合成。@r2-drive/api を import できる唯一の場所
│        ├─ routes/               … b.$bucketId.$.tsx / .styles.css.ts / -components/
│        ├─ components/<name>/    … index.tsx / styles.css.ts / <name>.test.tsx
│        └─ plugins/
│           ├─ file-type/         … registry.ts types.ts markdown/ image/ video/ audio/ opaque/
│           └─ object-action/     … registry.ts types.ts download/ copy-path/ delete/
└─ packages/
   ├─ core/                       … 純 TS。React も Workers API も参照しない
   │  └─ src/
   │     ├─ create-runner.ts      … 全拡張点が共有する唯一のディスパッチ実装
   │     ├─ object-descriptor.ts
   │     └─ errors/               … index.ts find-cause.ts
   └─ api/
      └─ src/
         ├─ index.ts              … Hono アプリの値 + AppType。@r2-drive/api
         ├─ client.ts             … hcWithType / createApiClient / ApiTransport。@r2-drive/api/client
         ├─ buckets/  uploads/    … ルート定義
         ├─ r2/                   … registry.ts list.ts get.ts range.ts put.ts delete.ts
         ├─ identity/             … types.ts cloudflare-access.ts static.ts factory.ts
         └─ plugins/object-source/… registry.ts types.ts r2-list/
```

**Phase 0 時点の構成である。** 後続フェーズで生えるもの:

| 追加物 | 場所 | Phase |
|---|---|---|
| `plugins/object-hook/`、`object-source/indexed/`、D1 スキーマ | `packages/api` | 1 |
| `plugins/playback/` | `packages/api` | 2 |
| `plugins/markdown-extension/`、エディタ | `apps/web` + `packages/editor`(抽出するなら) | 3 |
| `apps/transcoder/`(Rust crate + Dockerfile) | 新規 | 6 |
| `apps/transcoder-worker/`(DO + Container binding) | 新規 | 6 |

`file-colocation` スキルを TanStack Start に翻訳して適用する(`_components/` は Start の規約に合わせ `-components/`)。styles は対象ファイルの隣に `styles.css.ts` として置く。

### 11.3 パッケージの依存方向(これが分割可能性の実体)

```
apps/web ──→ @r2-drive/api/client ──→ @r2-drive/core
    │                                      ↑
    └──→ @r2-drive/api (worker.ts のみ) ───┘
```

**`packages/api` は `apps/web` に依存しない。** これが守られている限り、`packages/api` はいつでも独立した Worker になれる。

分割を「守られていることを願う規約」ではなく**機械的に強制する**。oxlint の `no-restricted-imports` で `@r2-drive/api`(Hono アプリの値)の import を `apps/web/src/worker.ts` 1 ファイルに限定する。他の場所は型と client ファクトリだけを持つ `@r2-drive/api/client` しか触れない。

分割時に変わるのは:

1. `apps/web/src/worker.ts` から `@r2-drive/api` の import が消える
2. `ApiTransport` に `{ kind: 'service-binding'; origin: string; binding: Fetcher }` が 1 変分増える
3. `wrangler.jsonc` に service binding が 1 つ増える

`ApiTransport` を判別可能ユニオンにし `switch` + `never` で消費しているため、変分を足した瞬間に対応漏れが全部コンパイルエラーになる(§8.4)。**この変分を今は足さない** — 実装が 1 つしかない拡張は作らないという §1 の規律に従う。

### 11.4 内部パッケージはソースを直接消費する

`packages/*` は npm 公開しない内部パッケージなので、`exports` を `./src/index.ts` に向け、**パッケージごとのビルド手順を持たない**。Vite と `@cloudflare/vite-plugin` がそのままトランスパイルする。dist の生成・watch・依存順ビルドという monorepo の定番の痛みを丸ごと回避できる。

型解決は `tsconfig.base.json` の `paths` で行う。TypeScript project references は入れない — Hono のドキュメントは RPC の IDE 性能対策として推奨しているが、その主要因は `hcWithType`(§8.3)で既に潰している。IDE が実際に重くなってから導入する。

### 11.5 バージョンの一元管理

Hono のドキュメントは **RPC を使う場合バックエンドとフロントエンドで Hono のバージョンを一致させること**を要求している。pnpm の catalog で一元管理する。

```yaml
# pnpm-workspace.yaml
packages: ['apps/*', 'packages/*']
catalog:
  hono: ^4.x
  react: ^19.x
  neverthrow: ^8.2.0
  zod: ^4.x
```

各パッケージは `"hono": "catalog:"` と書く。バージョン不一致による RPC 型崩壊が構造的に起きなくなる。

### 11.6 ツーリング

mise + pnpm + TypeScript v7(`@typescript/native-preview` / tsgo)+ oxlint + oxfmt + vitest + husky。設定は `www.napochaan.com` から移植した。

**規律の所在を取り違えないこと。** `typescript-project-setup` スキルには immutable/functional な厳格ルール群(`.push` 禁止、`Promise.all` 禁止、`max-lines-per-function`)を持つ `.oxlintrc.json` が入っているが、**`www.napochaan.com` が実際に使っている `.oxlintrc.json` はもっと軽い**(`func-style: expression` / `prefer-arrow-callback` / `unicorn/filename-case` / `react-perf`)。関数型の規律は lint ではなく `.claude/rules/*.md` に散文として置かれ、レビューで守られている。本リポジトリは後者に揃える。

`.oxlintrc.json` に 1 つだけ独自ルールを足している。

| ルール | 目的 |
|---|---|
| `no-restricted-imports` の `@r2-drive/api` 禁止(`apps/web/src/worker.ts` のみ override で許可) | §11.3 の依存方向を機械的に強制し、将来の Worker 分割可能性を守る |

`.claude/rules/*.md` のうち本設計に直接効くもの: `functional-programming.md`(不変性)、`function-style.md`(アロー関数のみ)、`typescript.md`(`satisfies` over `as`)、`no-barrel.md`、`naming.md`(kebab-case)、`colocation.md`、`tdd.md`。

**未確認のリスクが 3 つある。** すべて walking skeleton(§4.2)で確かめる。

1. `typescript-project-setup` スキルの **`react` variant は現時点でスタブ**であり、React / Vite / panda css 向けのアセットが存在しない。`apps/web` のスキャフォールドはこのスキルを拡張しながら進めることになる
2. **tsgo(TypeScript v7 native preview)+ Hono RPC の重い型推論 + Panda CSS のコード生成**という組み合わせは実績が確認できていない。型チェックが通るか、IDE が実用的な速度で動くかを最初に確かめる
3. **oxlint が `no-restricted-imports` を実装しているか未検証。**未対応なら受け入れ基準 6 は別の手段(依存グラフの検査スクリプト、あるいは `eslint-plugin-boundaries` の併用)で満たす

### 11.7 テスト配置

各プラグインは `run()` を直接叩いて単体テストできる(runner も他のプラグインも登場しない)。テストは対象ファイルの隣に置く。`packages/api` のテストは `@cloudflare/vitest-pool-workers` で本物の R2 binding を相手に走らせるため、`apps/web` とは vitest 設定が分かれる。

## 12. テスト方針

- **`@cloudflare/vitest-pool-workers`** — Miniflare 上で本物の R2 バインディングを持った Worker としてテストが走る。`list` の delimiter 挙動、Range の 3 形式、multipart の 5MiB 制約など、モックすると嘘になる部分を実物で検証する
- **プラグイン** — `run()` を直接呼ぶ純粋関数テスト
- **UI** — testing-library。キーボードナビゲーションと複数選択は明示的にテストする(製品の主張そのものであるため)

## 13. Phase 0 の受け入れ基準

痛点に 1 対 1 で対応させる。

1. 10,000 オブジェクトのフォルダをスクロールしてもフレーム落ちしない
2. 一度訪れたフォルダへの再訪が即座に描画される
3. マウスを使わずにナビゲート・複数選択・削除ができる
4. 5GB のファイルがアップロードでき、途中で中断してもサーバー側にゴミが残らない(abort される)
5. `workers_dev` が `false` で、Access 未認証のリクエストが Worker に到達しない
6. `@r2-drive/api`(Hono アプリの値)の import が `apps/web/src/worker.ts` 以外に現れると lint が落ちる — 将来の Worker 分割可能性が機械的に守られている

**4 の「中断からの再開」は含まない。** `uploadId` の永続化が必要であり、独立した機能である。中断時に確実に abort する、までを Phase 0 の責任とする。

## 14. 未決事項

| 項目 | 決定時期 |
|---|---|
| markdown エディタを TipTap にするか Milkdown にするか | Phase 3 開始時 |
| Phase 5(Vectorize 意味検索)の要否 | Phase 1 を使ってから |
| Phase 4 で SSR 純度と仮想化のどちらを取るか | Phase 4 設計時 |
| `packages/api` を独立 Worker として切り出す時期 | スクリプトサイズ上限に当たったとき、または Phase 6(遅くともここで分割は発生する) |
| エディタを `packages/editor` に切り出すか | Phase 3 設計時 |
| `ObjectHook` に `hookable` を使うか自作するか | Phase 1 設計時 |
| `typescript-project-setup` スキルの `react` variant をどう埋めるか | Phase 0 のスキャフォールド時 |
