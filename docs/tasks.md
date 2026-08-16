# タスク

次に何をやるかの一覧。設計の根拠は `docs/superpowers/specs/2026-08-14-r2-drive-design.md`(以下 spec)にあり、
ここはそこから**実行できる粒度**に落としたものだけを置く。

なぜ今その設計になっているか(タスクごとの裁定、レビューで見つかった実害、見送った判断とその理由)は
[`docs/superpowers/progress/2026-08-14-r2-drive-phase-0.md`](./superpowers/progress/2026-08-14-r2-drive-phase-0.md) にある。
下の「持ち越した Minor」は、そこから未着手のものを抜き出したものである。

## 現在地

**Phase 0 は #1 でマージ済み。** 一覧・アップロード・ダウンロード・削除が動く。

受け入れ基準(spec §13)の到達状況:

| # | 基準 | 状態 |
|---|---|---|
| 1 | 10,000 オブジェクトのフォルダをスクロールしてもフレーム落ちしない | ⚠️ 未計測 |
| 2 | 一度訪れたフォルダへの再訪が即座に描画される | ✅ prefetch + staleTime |
| 3 | マウスを使わずにナビゲート・複数選択・削除ができる | ✅ |
| 4 | 5 GB をアップロードでき、中断してもサーバーにゴミが残らない | ⚠️ 実 R2 未検証 |
| 5 | `workers_dev` が false で、Access 未認証が Worker に到達しない | ⚠️ 実 Access 未検証 |
| 6 | `@r2-drive/api` の import が `worker.ts` 以外に現れると lint が落ちる | ✅ |

---

## Task 16 — Phase 0 の受け入れ確認(Phase 1 より先)

**外部状態と大容量転送を伴うため保留してきたもの。**着手前に明示承認を取ること。
ここが通らないうちに Phase 1 の索引を載せると、性能問題の原因が「索引が無いから」なのか
「一覧の描画が遅いから」なのか切り分けられなくなる。

- [ ] **10,000 オブジェクトのフォルダで実測する。**Phase 0 の一番の売りであり、
      唯一まだ数字で示せていない基準。`pnpm test:browser` の管理下 Chromium で
      スクロール中のフレーム時間を取る
- [ ] **実 R2 に 5 GB をアップロードする。**multipart の実経路と、中断時に
      `abortMultipartUpload` が確実に呼ばれてゴミが残らないことを確認する
- [ ] **実 Access 越しにデプロイして検証する。**`ACCESS_AUD` を実タグに置き換え、
      未認証リクエストが Worker に到達しないことを確認する。`workers_dev` が
      false のままであることも合わせて見る
- [ ] **画像プレビューの帯域コストを確認する。**Phase 0 は派生サムネイルを持たず
      フルサイズ画像を一覧に出している。実測値が Phase 1 の優先度を決める
- [ ] タブ close 時の abort は **best-effort** であることを report に明記する。
      ブラウザは非同期 abort API の完了を保証しない。完了保証を偽装しない

---

## Phase 1 — D1 索引

### なぜやるか

痛点の残り 3 つが、すべて `R2.list()` の構造的限界に由来する(spec §1)。

| 痛点 | 原因 |
|---|---|
| 1 フォルダ 1000 件超で一覧が遅い | `R2.list()` はカーソル走査しかできない |
| 検索が使い物にならない | `R2.list()` に検索が無い |
| サムネイルが無い | 派生ファイルの索引が無い |

**R2 が真実であるという原則は崩さない。**索引はあくまで後付けのキャッシュ層で、
壊れてもバックフィル中でも一覧は出続けること(下記 `ObjectSource` を参照)。

### 拡張点をここで 2 つ導入する

Phase 0 で作らなかったのは、実装が 0 個または 1 個だったからである。Phase 1 で
**2 つ目が同時に登場する**ので、ここで初めて正当化される(spec §5.2)。

- [ ] **`ObjectHook`(アップロード後処理)** — 実装は「索引書き込み」と「サムネイル生成」の 2 つ
  - [ ] `hookable` を使うか自作するか決める(spec §14 の未決事項)。
        Phase 0 で不採用にした判断を、実装 2 つを前にして再評価する
  - [ ] ディスパッチは `packages/core/src/create-runner.ts` を共有する。
        新しいディスパッチ形を発明しない
- [ ] **`ObjectSource`(一覧のデータ供給元)** — 実装は 2 つ
  - [ ] `indexedSource` — 索引済みバケットだけ `ok` を返す
  - [ ] `r2ListSource` — 常に `ok`。索引が無い / 追いついていないバケットの受け皿
  - [ ] registry の順序は `[indexedSource, r2ListSource]`。**フォールバックは必ず最後**
  - [ ] 索引を意図的に壊した状態で一覧が出ることをテストで固定する

### 索引そのもの

- [ ] D1 のスキーマを決める(key / size / contentType / uploadedAt / etag / 幅・高さ・尺)
- [ ] **FTS5 で全文検索を張る。**spec §5 いわく、これだけで検索要求の大半が満たせる可能性がある。
      **Phase 5(Vectorize 意味検索)の要否は、これを実際に使ってから判断する**
- [ ] 既存バケットのバックフィル経路を作る。途中で失敗しても再実行できること
- [ ] **`MediaFacts` は variant で入れる。**`width?` / `height?` / `duration?` の
      3 つの optional を生やさない。それは 3 つの optional ではなく 1 つの状態である
      (`.claude/rules` の「optional field を作らない」/ spec §5.6)

```ts
// Phase 1 で追加: ObjectDescriptor & { readonly media: MediaFacts }
```

### Phase 1 で必ず対処すると決めたもの

- [ ] **境界線トークンの強制機構を作る。**Task 11.5 のレビューで残った宿題。
      token レベルのテストは「`border.interactive` を選べば安全」までしか保証できず、
      「このコンポーネントに正しいトークンを選んだか」は保証できない。Phase 0 では
      「境界線だけがコンポーネントの存在を示す」ケースが稀だったので規約に留めたが、
      **Phase 1 でテキスト入力とチェックボックスが入る時点で機械的に守る**
      (lint ルールかラッパコンポーネント)。
      放置した場合の帰結は、装飾トークンが機能的境界に使われ AA を割ったまま気付けないこと

---

## 持ち越した Minor(triage 対象)

Phase 0 のレビューで「実害が小さい」と判断して送ったもの。着手順は未定だが、
**上 2 つは実害が具体的**なので Phase 1 の作業ついでに拾うのが安い。

### 実害がある

- [ ] `describeCauseChain` が単一リンクのエラーで literal `'undefined'` を吐く
      (`packages/core/src/errors/find-cause.ts`)。**全エラーログにファントムの
      `'undefined'` が出続ける。**`findCause` が既に持つ `cause === undefined` ガードで直る。
      あわせて `String(value)` が `.claude/rules/primitive-coercion.md` に抵触している
- [ ] `uploadPart` の失敗が理由を問わず `UploadSessionError('unknown-upload-id')` に潰れる
      (`packages/api/src/uploads/index.ts`)。**R2 が「最終パート以外が 5 MiB 未満」で
      拒否した場合も `unknown-upload-id` として返るため、クライアントに誤った理由が届く。**
      `part-too-small` という reason が定義されているのに使われていない

### 設計の一貫性

- [ ] **`.match` のネストが 8 ハンドラすべてに存在する**(`buckets/index.ts` 4 + `uploads/index.ts` 4)。
      各ハンドラが `resolveBucket` に 1 回、非同期処理に 1 回の計 2 回 `.match` を呼び、
      `(error) => toErrorResponse(c, error)` が重複している。
      `resolveBucket(...).asyncAndThen(...).match(onOk, onErr)` で 1 回に畳める。横断リファクタ
- [ ] `BucketNotFoundError` が binding 名(`binding missing: BUCKET_PHOTOS`)をワイヤに載せる。
      `to-error-response.ts` のコメントが「バケット名を漏らさない」と約束しているのと矛盾する
- [ ] `contentTypeOf` が空文字の `contentType` を「不在」として扱わない(`??` なので素通り)
- [ ] `toErrorResponse` がログ出力とレスポンス生成を兼ねており command/query 分離に反する
- [ ] `const head = await bucket.head(key)` が neverthrow の外にある(`packages/api/src/r2/`)
- [ ] 導出 state が `closed` のとき context menu の anchor state が `open` のまま残る
      (アプリ内経路では踏めない)

### テストの穴

- [ ] `GET /buckets` にテストが 1 件も無い
- [ ] `next: {kind:'more'}` とカーソル往復が未検証。`PAGE_SIZE` がモジュール定数なので
      201 個入れないと truncated にできない。**`ListInput` に limit を必須フィールドとして
      持たせると注入でテスト可能になる**
- [ ] `contrast.test.ts` が無く、`oklchToSrgb` / `relativeLuminance` に
      トークン固定値経由でない単体テストが無い
- [ ] `strokeWidth: 'default'` の値を固定するテストが無い
- [ ] `.mdx` / `.markdown` が markdown プラグインのテストで踏まれていない
- [ ] テストの `as ObjectPage` が `.claude/rules/typescript.md` に抵触。`parsePage` ヘルパーに封じる
- [ ] select-all ショートカット判定が react-aria の `isMac()` と別ソース(`navigator.platform`)を見ている
- [ ] `getApiClient()` に SSR 時の診断ガードが無い / SSR で元リクエストのヘッダを
      全転送している(allowlist 化の余地)

---

## この先

spec は Phase 1 以降を**方針と接続点のみ**記述している。着手時に設計を詰める。

| Phase | 内容 | 開始時に決めること |
|---|---|---|
| 2 | ビューア。`FileTypeCapability` を `opaque` / `view` / `view-and-edit` の variant に広げ、`Viewer` は `lazy()` で読む | — |
| 3 | Markdown エディタと共同編集(y-durableobjects)。`MarkdownExtension` を導入 | **TipTap か Milkdown か。**Milkdown なら `MarkdownExtension` 型はフレームワーク側に置き換わる |
| 4 | skyline ギャラリー | **SSR 純度と仮想化のどちらを取るか。**仮想化するとコンテナ幅の計測が要りクライアントコンポーネント化が避けられない |
| 5 | Vectorize による意味検索 | **そもそも要るか。**Phase 1 の FTS5 を使ってから判断する |
| 6 | Rust + Cloudflare Containers でトランスコード | — |

### Worker 分割について

`packages/api` を独立 Worker に切り出すのは、次のどちらかが起きたとき(spec §11)。

1. Worker のスクリプトサイズ上限に当たったとき(React SSR + Hono + エディタが同居する Phase 3 以降で現実的)
2. **Phase 6 のトランスコード基盤が登場するとき — これは確定している**

それまでは単一 Worker のままでよい。境界は既にパッケージとして存在し、lint が守っている。
変わるのはデプロイ単位だけである。
