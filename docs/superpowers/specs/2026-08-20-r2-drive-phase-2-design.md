# r2-drive Phase 2 設計 — ビューア群

親 spec: `2026-08-14-r2-drive-design.md`(§2 フェーズ分割、§5.3 `FileTypePlugin`)。
本 spec は Phase 2「ビューア群(画像 / 動画 Range 再生 / 音楽 / markdown 表示)」を実装可能な粒度に落としたものである。

## 1. 目的

一覧から任意のファイルを開いて中身を確認できるようにし、痛点「プレビューが貧弱」を解消する。

- 画像・動画・音楽・markdown・テキスト/コードの 5 系統のビューアを提供する
- ビューアは URL で共有できる(deep link)
- ビューアを閉じたとき、一覧のスクロール位置と選択状態が保持されている
- ビューアを開いたまま同一フォルダ内の前後のファイルへ移動できる

### 非目的

- 編集(`view-and-edit` capability は Phase 3 で Editor 実装と同時に導入する)
- HLS 再生(Phase 6。ただし本 Phase で導入する `PlaybackResolver` が接続点になる)
- サムネイル生成・PDF / CSV など追加ファイルタイプ(必要になった時点でプラグインを 1 つ足す)
- ビューア内でのオブジェクト操作(削除・リネーム等)。既存の一覧側アクションを使う

### スコープ判断の補足

親 spec の Phase 2 は 4 タイプ(画像 / 動画 / 音楽 / markdown)だが、markdown ビューアに
shiki + `code.*` token がどのみち入るため、テキスト/コードビューア(`textPlugin`)を追加する。
限界コストがプラグイン 1 つ分であり、R2 に置いた設定ファイルやログの確認という実用頻度の高い
ユースケースを拾える。Open/Closed 原則(プラグイン 1 つ + registry 1 行で完結)の実証にもなる。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 画面構造 | 一覧 route の search param `?view=<key>` + overlay | deep link 可能かつ、閉じたとき一覧の状態(スクロール・選択)が残る。search param 変更は再マウントを起こさない |
| overlay 実装 | react-aria-components の `Modal` + `Dialog` | ui rules の実現順序 2。ESC・フォーカストラップ・aria が仕様として付く |
| 前後移動 | Phase 2 に含める。navigate は `replace: true` | 画像連続閲覧が主要ユースケース。戻るボタン 1 回でビューアが閉じる(めくった枚数だけ戻らせない) |
| 動画/音楽 UI | ネイティブ `controls` | 実現順序 1。Range 再生・シーク・PiP・キーボード操作がブラウザ実装で手に入る。Phase 6 の HLS も src 差し替えで済む |
| markdown レンダラ | react-markdown + remark-gfm + shiki | remark ベース。Phase 3 で Milkdown を選ぶ場合も知見が繋がる。生 HTML を描画しないので XSS 安全 |
| syntax highlight | Phase 2 で導入(markdown 内コードブロック + text ビューア全文) | ユーザー判断でスコープに含めた。`code.*` token の移植が前提条件になる |
| テキスト系サイズ上限 | 1 MiB。超過時は fetch せず案内 + ダウンロード導線 | 全文をクライアントに読む方式の防衛線。サイズは descriptor で事前に分かる |
| capability の variant | Phase 2 は `opaque` / `view` の 2 つのみ | `view-and-edit` を実装 0 個で導入しない。Phase 3 で variant を足せば消費側の exhaustive switch が全箇所コンパイルエラーになる — それが意図した拡張手順である |

## 3. `FileTypeCapability` — コアに触る唯一の変更

`apps/web/src/plugins/file-type/types.ts` の `FileTypeMatch` に `capability` を追加する。

```ts
export type ViewerProps = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

export type LazyViewer = LazyExoticComponent<ComponentType<ViewerProps>>;

export type FileTypeCapability =
  | { kind: 'opaque' }
  | { kind: 'view'; Viewer: LazyViewer };

export type FileTypeMatch = {
  readonly typeId: string;
  readonly label: string;
  readonly Icon: ComponentType<IconProps>;
  readonly Preview: ComponentType<PreviewProps>;
  readonly capability: FileTypeCapability;
};
```

- `Viewer` は `lazy(() => import('./viewer'))`。eager なのは従来どおり `typeId` / `Icon` / `Preview` だけで、一覧画面の初期バンドルは太らない
- 消費側(overlay)は `capability.kind` を `switch` し、`default` で `const _exhaustive: never` を書く
- `Editor?` という optional は作らない(親 spec §5.3 の原則そのまま)

registry の並び(specific → broad):

```ts
export const fileTypePlugins = [
  markdownPlugin,  // 拡張子 / text/markdown
  imagePlugin,     // image/*
  videoPlugin,     // video/*
  audioPlugin,     // audio/*
  textPlugin,      // ← 新規。text/* と既知のコード系拡張子
  opaquePlugin,    // 常に ok。capability: { kind: 'opaque' }
] as const satisfies readonly FileTypePlugin[];
```

`textPlugin` は markdown より後・opaque より前。`text/markdown` は markdownPlugin が先に取るので二重マッチしない。

## 4. 画面構造

### 4.1 ルーティング

`b.$bucketId.$` route に `validateSearch`(zod)で `view` を追加する。

```
/b/photos/2024/?view=2024/cat.jpg
```

- `view` はオブジェクトの完全な key(prefix 込み)。エンコードは router に任せる
- ファイル行の `onAction`(ダブルクリック / Enter。GridList の仕様)で `?view=<key>` へ navigate。
  フォルダ行の既存 `onAction`(フォルダを開く)と対称になる
- `capability.kind === 'opaque'` の行は `onAction` を持たない(overlay を開かない)
- 閉じる(×ボタン / ESC / 背景クリック)= `view` を外して navigate。一覧は再マウントされない

### 4.2 overlay

react-aria-components の `Modal` + `Dialog`。`isOpen` は `view` search param の有無から導出し、
`onOpenChange(false)` で param を外す(状態の実体は URL のみ。React state に複製しない)。

```
┌────────────────────────────────────┐
│ cat.jpg                 [× 閉じる] │  ← Dialog ヘッダ。aria-label = ファイル名
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ │         Viewer 本体            │ │  ← lazy import + Suspense
│ │                                │ │
│ └────────────────────────────────┘ │
│ [←前へ]  2.4 MB · image/jpeg [次へ→] │  ← メタデータは等幅 + tabular-nums
└────────────────────────────────────┘
```

- メタデータ(サイズ・contentType・更新日時)は design-direction に従い `fonts.mono` +
  `tabular-nums` で組む。これは装飾ではなく本来の情報である
- Viewer の lazy import は `Suspense` で受け、フォールバックは静的なローディング表示

### 4.3 前後移動

- ←/→ キーと前へ/次へボタンで、一覧の描画順(= 現在のソート順)における前後の
  **view 可能な**ファイルへ移動する。`opaque` とフォルダはスキップする
- navigate は `replace: true`。ブラウザバック 1 回で overlay ごと閉じる
- 対象は**読み込み済みページ内**に限る。末尾に達したら止まる(次ページの自動 fetch はしない。
  無限スクロールと overlay の結合は複雑さに見合わない)
- 次のファイルが画像なら `new Image().src = contentUrl` で 1 枚だけ先読みする

### 4.4 deep link の解決

`?view=` 付き URL を直接開いた場合、一覧の読み込み済みページに descriptor が無いことがある。

1. 読み込み済みページから key で探す
2. 無ければ新設の単一オブジェクト API(§5)で取得する(TanStack Query、key は `['object', bucketId, key]`)
3. 404 なら overlay 内に「見つからない」状態を表示する(§8)

## 5. サーバ側の追加 — 単一オブジェクト取得 API

Phase 2 で唯一のサーバ変更。既存の Hono RPC チェーンに 1 route 追記する。

```
GET /api/buckets/:bucketId/objects/:path{.+}   … ObjectDescriptor を 1 件返す
```

- 実体は `R2.head()`。既存 `r2/get.ts` の系譜に `head` を足す
- 既存 route との衝突: `GET /:bucketId/objects`(一覧。splat なし)、
  `DELETE /:bucketId/objects/:path{.+}`(メソッド違い)とは衝突しない
- 見つからない場合は既存の `ObjectNotFoundError` → `objectNotFoundResponder`(404)がそのまま効く
- Range 配信(`GET /:bucketId/content/:path{.+}`)は Phase 0 で実装・テスト済みであり、本 Phase では触らない

## 6. 各ビューア

すべて `apps/web/src/plugins/file-type/<typeId>/viewer.tsx` に置き、プラグインから lazy import する。

| typeId | 実装 | 補足 |
|---|---|---|
| image | `<img>` を viewport にフィット(`object-fit: contain`) | `getContentUrl`(etag 付き immutable)をそのまま src に |
| video | `<video controls preload="metadata">` | src は `PlaybackResolver` で解決(§6.1) |
| audio | `<audio controls>` + ファイル名表示 | 同上 |
| markdown | 本文 fetch → react-markdown + remark-gfm + shiki | fetch は TanStack Query(etag 付き URL なのでキャッシュが効く) |
| text | 本文 fetch → shiki 全文ハイライト | 拡張子 → 言語のマップ。未知の拡張子は plain 表示。既知の罠: `.ts` に `video/mp2t` が付いた場合は registry 順で video が先に取る(許容する。直すならアップロード側の contentType 決定であり、ビューアの分岐ではない) |
| opaque | Viewer なし(`kind: 'opaque'`) | 行から開けない |

### 6.1 `PlaybackResolver`(親 spec §5.2 の Phase 2 拡張点)

再生ソースの解決をプラグイン化する。置き場所は `apps/web/src/plugins/playback/`
(src を選ぶのはクライアントの関心事であるため)。

```ts
export type PlaybackSource = { readonly kind: 'raw'; readonly src: string };
// Phase 6 で { kind: 'hls'; manifest: string } が加わる

export type PlaybackResolverInput = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

export type PlaybackResolver = Processor<PlaybackResolverInput, PlaybackSource>;

export const playbackResolvers = [
  // Phase 6: hlsResolver がここに入る(トランスコード済みのみ ok)
  rawRangeResolver, // 常に ok。content URL を返す最終防衛線
] as const satisfies readonly PlaybackResolver[];
```

導入時の実装は `rawRangeResolver` 1 つだが、2 つ目(`hlsResolver`)は Phase 6 で確定している。
親 spec の拡張点導入条件「名前のついたフェーズで 2 つ目が確定しているとき」を満たす。

### 6.2 テキスト系のサイズ上限

- markdown / text ビューアは本文全体をクライアントに読む。**上限 1 MiB**
- `descriptor.size` で事前判定し、超過時は fetch 自体を発行せず
  「大きすぎるため表示できません(サイズ表示)+ ダウンロード」の案内を出す
- 上限は viewer 側の定数とし、単体テストでガードの発火を検証する

## 7. shiki と `code.*` token

- `www.napochaan.com` の `semanticTokens.colors.code.*` をコントラスト注記ごと
  `apps/web/src/themes/tokens/` に移植し、`tokens.test.ts` に AA 検証を追加する
  (design-direction の「持ち込むならそこから」に従う)
- shiki のテーマは組み込みテーマではなく、**`code.*` token から組んだカスタムテーマ**とする。
  strictTokens と `contrastRatio()` テストの保護をハイライト色にも通すためである
- 言語 grammar は `@shikijs/langs/*` の動的 import で lazy 化する。プリロードする言語リストは
  リテラル(バンドラ制約)と export された定数を同一ファイルに隣接させ、
  cross-module-sync-test ルールに従い両モジュールを import するテストで 1:1 同期を固定する
- shiki 本体も viewer チャンク内に閉じる(markdown / text の viewer からのみ import)

## 8. エラーとフォールバック

| 事象 | 挙動 |
|---|---|
| `<img>` / `<video>` / `<audio>` の読み込み失敗 | overlay 内にエラー状態 + ダウンロード導線。一覧のサムネイル(`Preview`)の onError フォールバックと同じ思想 |
| 本文 fetch 失敗(markdown / text) | Query のエラーを overlay 内に表示。リトライ導線 |
| `?view=` 対象が存在しない(削除済み・typo) | overlay 内に not-found 状態。閉じれば一覧に戻る。route 全体は落とさない |
| lazy import 失敗(デプロイ跨ぎ等) | overlay 内 ErrorBoundary で受け、再読み込み導線 |

エラーはすべて overlay の内側に閉じ込める。ビューアの失敗が一覧を壊してはならない。

## 9. テスト戦略

| 対象 | 方式 |
|---|---|
| capability 解決・プラグイン順序(text と markdown の優先関係含む) | vitest (jsdom) |
| サイズ上限ガード(境界値: ちょうど 1 MiB / 1 バイト超過) | vitest (jsdom) |
| `PlaybackResolver`(raw が常に ok を返す) | vitest |
| `code.*` token のコントラスト | 既存 `tokens.test.ts` に追加 |
| shiki プリロード言語の 1:1 同期 | cross-module-sync-test パターン |
| 単一オブジェクト API(200 / 404 / path エンコード) | `@cloudflare/vitest-pool-workers`(実 R2) |
| overlay の開閉・前後移動・opaque スキップ | vitest (jsdom) + react-aria の testing 手法 |

Range 配信は Phase 0 のテストでカバー済み。本 Phase では追加しない。

## 10. 意図的に Phase 2 から外したもの

| 外したもの | 理由 / いつやるか |
|---|---|
| `view-and-edit` variant | Phase 3。variant 追加で消費側 switch が全箇所コンパイルエラーになるのが意図した手順 |
| HLS 再生 | Phase 6。`PlaybackResolver` の配列先頭に resolver を足すだけの状態にしてある |
| 前後移動での次ページ自動 fetch | 無限スクロールとの結合が複雑。読み込み済みページ内で止まる |
| カスタムメディアコントロール | ネイティブ `controls` で足りる。デザイン一貫性のためだけに a11y を自前で背負わない |
| サムネイル | Phase 1 の `ObjectHook` 系。ビューアとは独立した機能 |
| ビューア内でのオブジェクト操作(削除等) | 一覧側の既存アクションで足りる。重複導線を作らない |

## 11. 受け入れ基準

1. 一覧でファイルをダブルクリック(または Enter)すると overlay でビューアが開き、
   閉じると一覧のスクロール位置と選択状態が保持されている
2. `?view=` 付き URL を直接開くと、一覧の読み込み状態に関わらず該当ファイルのビューアが表示される
3. 動画・音楽がシーク可能である(206 応答で任意位置から再生できる)
4. markdown が GFM(テーブル・タスクリスト)込みでレンダリングされ、コードブロックがハイライトされる
5. ←/→ で同一フォルダ内の前後ファイルへ移動でき、ブラウザバック 1 回でビューアが閉じる
6. 1 MiB 超のテキスト系ファイルは fetch されず、案内とダウンロード導線が表示される
7. `code.*` token を含む全 color token が AA 検証テストを通過している
8. 一覧の初期バンドルに viewer / shiki / react-markdown のチャンクが含まれていない
