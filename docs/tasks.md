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
| 1 | 10,000 オブジェクトのフォルダをスクロールしてもフレーム落ちしない | ❌ **未達**([計測結果](../reports/2026-08-17-task-16-perf.md)) |
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

- [x] **10,000 オブジェクトのフォルダで実測する。**→ [report](../reports/2026-08-17-task-16-perf.md)。
      **描画は白いが実アプリ経路は未達。**回帰ゲートとして
      `apps/web/src/routes/-components/object-list/object-list.perf.browser.test.tsx` を追加した
- [ ] **実 R2 に 5 GB をアップロードする。**multipart の実経路と、中断時に
      `abortMultipartUpload` が確実に呼ばれてゴミが残らないことを確認する
- [ ] **実 Access 越しにデプロイして検証する。**`ACCESS_AUD` を実タグに置き換え、
      未認証リクエストが Worker に到達しないことを確認する。`workers_dev` が
      false のままであることも合わせて見る
- [x] **画像プレビューの帯域コストを確認する。**→ 15 秒のスクロールで **196 MB**。
      142px 四方の表示に 1280x960 を配っている(約 61 倍)。**派生サムネイルの優先度は高い**
- [x] タブ close 時の abort は **best-effort** であることを report に明記した

### 実測で判明し、Phase 1 より先に潰すべきもの

`docs/tasks.md` 執筆時点では存在を知らなかった項目である。すべて上の report に根拠がある。

- [x] **1 ページ 100 件 → 1,000 件。**`include: ['httpMetadata']` を外し、`limit` を
      `ListInput` の必須フィールドにした。**往復 110 → 19 回。**代償は `contentType` が
      拡張子由来になること(単体取得は `get()` の値をそのまま返すので影響しない)
- [x] **content-addressed URL + `Cache-Control`。**`?v=<etag>` が一致するときだけ
      `private, max-age=31536000, immutable`。**再訪時の画像転送量 206 MB → 0 バイト。**
      `hono/cache` は使っていない(エッジキャッシュはクライアント転送量を減らさないため。
      R2 の Class B オペレーション削減が目的になったら再検討する)
- [ ] **コレクション追加のたびに全体が作り直されている。**上の 2 つを直した後も、
      3 秒あたりのフレーム数が 308 → 197(103fps → 66fps 相当)へ単調に落ち、
      200ms 級の long frame が 18 秒で 13 本残る。
      **1 回の追加コストはページの件数ではなく、その時点のコレクション全体の件数で決まる**
      (ページを 10 倍にしても max が 249ms → 216ms としか変わらなかったことが根拠)。
      **したがってページサイズでは解けないし、D1 索引でも直らない。**索引で速くなるのは
      list の応答であって、クライアント側の再構築ではない
    - 着手前に react-aria のコレクション実装をプロファイラのコールツリーで確認すること。
      「O(n) の作り直し」は計測から導いた**推論であって、実装を読んで確かめてはいない**
- [ ] **画像プレビューの初回コストは残っている。**再訪はキャッシュで消えたが、
      初回は依然 15 秒のスクロールで 196 MB。142px 四方に 1280x960 を配っているため。
      **派生サムネイルで 1/60 になる。**Phase 1 では意図的に外した(Phase 1 spec §9)

---

## Phase 1 — オブジェクト索引と検索

**設計は [`docs/superpowers/specs/2026-08-17-r2-drive-phase-1-design.md`](./superpowers/specs/2026-08-17-r2-drive-phase-1-design.md)。**
以下はそこから実行できる粒度に落としたものだけ。判断の根拠は spec を読むこと。

### 前提が 2 つ変わった

Phase 0 spec は Phase 1 を「D1 索引」「`ObjectHook` を導入」と書いていたが、**どちらも変更した。**

| | Phase 0 spec | Phase 1 spec |
|---|---|---|
| 索引の基盤 | D1 | **Durable Object の SQLite**(1 バケット = 1 DO) |
| `ObjectHook` | Phase 1 で導入 | **導入しない**(実装が 1 つになるため) |

追加 binding は **`OBJECT_INDEX` の 1 つだけ**。新しい抽象はゼロ。`ObjectDescriptor` のワイヤ型も変わらない。

### 実装は完了した(2026-08-18)

**実測と受け入れ基準 7 件の判定は [`reports/2026-08-18-phase-1-index-perf.md`](../reports/2026-08-18-phase-1-index-perf.md)。**
`photos` は `indexed: true` に切り替え済み。`media` は R2 経路の対照として `indexed: false` のまま残してある。

一覧の 1 ページ目(10,000 件のフォルダ)は **17.69 ms → 7.35 ms(約 2 倍)。**
バックフィルは 10,000 件を 10 ページ・約 5 秒で取り切る。**7 件すべて満たした**が、
基準 2(検索)と基準 6(バックフィル)には数字の意味を狭める注記がある。レポートを読むこと。

### 着手前に潰す(実装計画の最初の 2 つ)

- [x] **DO SQLite で FTS5 が使えることを実測で確かめる。**falsy なら検索の設計だけ組み直す
      → 使える(`packages/api/test/fts5-availability.test.ts`)
- [x] **Drizzle の `await` 連鎖で write coalescing が保たれるかを確かめる。**
      → **保たれない。**連続した `sql.exec` は失敗した文の直前までを巻き戻さないことを対照実験で確認し
      (`packages/api/test/sql-exec-atomicity.test.ts`)、`db.transaction()` で明示的に囲う形にした

### DO と索引

- [x] `SqliteStore`(基底)→ `ObjectIndex` の継承構成。**RPC は prototype chain を見るので
      継承メソッドも公開される。**arrow property で書くと stub から呼べなくなる
- [x] スキーマ 4 表(`objects` / `prefixes` / `objects_fts` / `meta`)。`bucket_id` 列は持たない
- [x] `worker.ts` が `export { ObjectIndex } from '@r2-drive/api'` で再輸出する
- [x] **FTS5 は upsert と同じ書き込み経路で明示的に更新する。**更新漏れはテストで封じる

### 経路

- [x] アップロード / 削除の後に `stub.upsert()` / `stub.remove()` を await する
- [x] `indexedSource` を registry の先頭に足す。判定は `bucketDescriptors.indexed`(**deploy 時の設定**)
- [x] `GET /buckets/:id/search?q` を足す。戻りは既存の `ObjectPage`
- [x] バックフィル: `alarm()` が R2 を 1,000 件ずつ舐めてカーソルを `meta` に置く。冪等であること
- [x] 起動 `POST /buckets/:id/index/backfill` と観測 `GET /buckets/:id/index/status`
- [x] **索引が返す cursor に経路タグを付ける(Ruling 18)。**`indexed: false → true` の切り替え
      deploy を跨いだ R2 の opaque cursor が索引経路に渡ると、**エラーにならず静かに
      1 ページ目を返し続ける。**`k1:` / `q1:` のタグで検出して 412 にする

### Phase 1 から持ち越したもの

- [ ] **`ErrorName` に `'ForeignCursorError'` を足して 400 で返す。**今は `packages/core` を
      触らない制約のため `PreconditionFailedError`(412)に載せている。
      `packages/core` を触るタイミングで移すこと(レポートの Ruling 18 節に理由)
- [ ] **日本語検索の中間一致。**FTS5 の既定 tokenizer は連続する CJK を 1 トークンにするため、
      `休暇の写真.jpg` は `休暇` では引けるが `写真`(末尾)/ `暇の写`(中間)では引けない。
      **Vectorize(Phase 5)より先に bigram トークン化を試す価値がある**(レポートの「検索」節)
- [ ] **バックフィル中は同じ DO への読み取りが最大 3.2 秒ブロックされる。**10,000 件では
      運用手順(`indexed: false` のままバックフィル → complete 確認 → `true` にして再デプロイ)で
      避けられるが、**100,000 件規模ではバッチ upsert を検討すること**

### 意図的に外したもの(理由は spec §9)

サムネイル生成 / `ObjectHook` / `runAll` / Cloudflare Queues / `IMAGES` binding /
`MediaFacts` / 空フォルダの表現 / R2 SQL / Vectorize。

**入れる条件も spec §9 に書いてある。**「サムネイル生成 + もう 1 つの後処理」が揃ったとき、
初めて `ObjectHook` の実装が 2 つになり拡張点の導入根拠が立つ。
**課金は障壁ではない**(`IMAGES.info()` は常に無料、変換は月 5,000 unique まで無料)。
**外した理由は複雑さである。**

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
- [ ] `toErrorResponse` がログ出力とレスポンス生成を兼ねており command/query 分離に反する
- [ ] `const head = await bucket.head(key)` が neverthrow の外にある(`packages/api/src/r2/`)
- [ ] 導出 state が `closed` のとき context menu の anchor state が `open` のまま残る
      (アプリ内経路では踏めない)

### テストの穴

- [ ] `GET /buckets` にテストが 1 件も無い
- [x] `next: {kind:'more'}` とカーソル往復が未検証だった。`ListInput` に `limit` を必須
      フィールドとして持たせて注入可能にし、`packages/api/src/r2/list.test.ts` で 3 件 +
      `limit: 2` の往復を固定した(モジュール定数 `PAGE_SIZE` は削除)
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
| 5 | Vectorize による意味検索 | **まだ決まらない。**Phase 1 の FTS5 を実測した結果、ASCII のファイル名はトークン前方一致で実用になり、日本語は中間一致が引けない。**先に bigram トークン化を試す価値がある**([実測](../reports/2026-08-18-phase-1-index-perf.md)) |
| 6 | Rust + Cloudflare Containers でトランスコード | — |

### Worker 分割について

`packages/api` を独立 Worker に切り出すのは、次のどちらかが起きたとき(spec §11)。

1. Worker のスクリプトサイズ上限に当たったとき(React SSR + Hono + エディタが同居する Phase 3 以降で現実的)
2. **Phase 6 のトランスコード基盤が登場するとき — これは確定している**

それまでは単一 Worker のままでよい。境界は既にパッケージとして存在し、lint が守っている。
変わるのはデプロイ単位だけである。
