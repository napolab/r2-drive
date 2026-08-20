# r2-drive ギャラリービュー設計 — Phase 4 前倒し + ObjectHook 導入

親 spec: `2026-08-14-r2-drive-design.md`(§2 Phase 4、§5.2 `ObjectHook`、§10 skyline 自作の判断)。
関連: `2026-08-17-r2-drive-phase-1-design.md` §9(ObjectHook を外した理由と入れる条件)。

ユーザー要望「first view はいきなり www.napochaan.com のギャラリー表示がいい」を受け、
Phase 4(skyline ギャラリー)を前倒しする。寸法既知を前提とする skyline の性質上、
Phase 1 で延期した `ObjectHook` と `MediaFacts` がここで合流する。

## 1. 目的

- バケット(フォルダ)を開いたときの**既定ビューを skyline ギャラリー**にする
- 参照実装(`napolab/www.napochaan.com` の `src/components/gallery-archive/skyline/`)の哲学を守る:
  **計測ゼロ・レイアウトシフトゼロ**。縦横比は索引が知っている
- ギャラリーが対象にするのは**画像 + 動画**。ユーザー要望(2026-08-21)により、フォルダや
  他ファイルの導線(チップ列)は外し、ギャラリーはメディアだけの密な壁にする
- タイル一覧(従来表示)とは切替可能。既存の選択・キーボード・削除・ビューア連携を失わない

### 非目的

- サムネイル生成(ObjectHook の 3 実装目として後続。原寸 + ブラウザキャッシュで開始する)
- wide 画像の span 拡大(全アイテム span=1。判定材料が無いうちは YAGNI)
- 動画の寸法抽出(`mediaFactsHook` は image/* だけを probe する。動画セルは ratio=1 の
  正方形で pack する — 描画はする、寸法だけ持たない)
- `/`(バケット一覧)の変更(ギャラリーはバケットを開いた後の話)

### 前提(依存)

PR #8(`fix/backfill-write-race`)の上に積む。バックフィル追い掛けフェーズ(§5)は
I3 で入れた alarm ループ・tombstone・鮮度ガードの構造をそのまま使う。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| スコープ | バケットを開いたときの既定ビュー。`?mode=tiles` で従来表示 | ユーザー選択。/ のバケット一覧は変えない |
| 寸法の取得 | ObjectHook + 索引(DO SQLite)に保存。抽出は R2 先頭バイトのヘッダ解析 | 計測ゼロ・シフトゼロの唯一の道。`IMAGES.info()` は Images 有効化が要るため不採用 |
| 画像 | 原寸(etag 付き content URL)で開始 | R2 egress 無料 + immutable キャッシュ。サムネイルは後続に分離 |
| 描画基盤 | 既存 Virtualizer + GridList に custom `SkylineLayout` を差す | 選択・cmd+A・キーボード・onAction(→ `?view=` ビューア)・削除がそのまま乗る。受け入れ基準「10,000 件スクロール」も維持 |
| 非画像・非動画の扱い | ギャラリーには出さない。フォルダ・他ファイルはタイルビューの役割 | チップ列(2026-08-21 まで存在した折衷案)は撤去。ギャラリーは画像+動画だけの密な壁にする、というユーザー判断 |
| 動画 | サムネイルは先頭フレーム(`<video preload="metadata">`)、寸法未抽出のため ratio=1 | 寸法抽出は image/* のみ(§3.3)。動画も pack はするが正方形セルになる |
| 未抽出画像 | ratio=1(正方形、`object-fit: cover`)で pack に混ぜる | シフトゼロのまま全画像が出る。抽出が追いつけば正確な比率になる |
| 画像・動画 0 件のフォルダ | タイル表示へ自動フォールバック | 空のギャラリーを見せない |

## 3. `MediaFacts` — 索引スキーマとワイヤ型

### 3.1 スキーマ

`objects` テーブルに列を足す(DDL は起動時適用。既存 DO には `ALTER TABLE ... ADD COLUMN` を
冪等に流す — SQLite に `ADD COLUMN IF NOT EXISTS` は無いので、`PRAGMA table_info` で列の
有無を見てから流すか、例外を握る初期化ヘルパを DDL 適用部に足す)。

```sql
ALTER TABLE objects ADD COLUMN width INTEGER;   -- NULL = 未抽出 or 非画像
ALTER TABLE objects ADD COLUMN height INTEGER;
```

DB 層は NULL 許容の 2 列でよい(SQLite に variant は無い)。**variant はワイヤ型で表す。**

### 3.2 ワイヤ型

```ts
// packages/core/src/object-descriptor.ts
export type MediaFacts = { readonly kind: 'image'; readonly width: number; readonly height: number } | { readonly kind: 'none' };

export type ObjectDescriptor = {
  // 既存フィールドはそのまま
  readonly media: MediaFacts;
};
```

- `width?` / `height?` を生やさない(親 spec §6「3 つの optional ではなく 1 つの状態」そのまま)
- **全経路が `media` を返す**: 索引経路は列から、R2 直(`r2-list`)・`headObject` は常に
  `{ kind: 'none' }`(R2 の list は寸法を知らない)。ギャラリーは索引済みバケット
  (`indexed: true`)で真価が出るが、未索引でも ratio=1 で成立する
- ワイヤ型変更だがモノレポ同時デプロイなので互換問題なし。既存テストの descriptor fixture は
  一括で `media: { kind: 'none' }` を足す

### 3.3 寸法抽出

- R2 から `Range: bytes=0-131071`(128 KiB)で先頭を読み、ヘッダから寸法を得る
- 実装は npm を先に調査する(車輪の再発明禁止ルール)。第一候補 `image-size`
  (Uint8Array 対応・依存ゼロを実装前に確認)。Workers で動かなければ
  png / jpeg / webp / gif の 4 形式だけ自前パースに落とす(その場合は spec のこの節に
  「なぜ既製品を使わないか」を追記すること)
- 抽出失敗(壊れた画像・未対応形式・SOF がチャンク外の JPEG など)は `kind: 'none'` の
  まま残す。**失敗で索引書き込み全体を落とさない**(寸法はあくまで飾り、索引が本体)

## 4. `ObjectHook` — 拡張点の導入(Phase 1 の宿題)

Phase 1 spec §9 の導入条件「実装が 2 つ揃ったとき」がここで成立する:

1. `indexWriteHook` — アップロード完了 / 削除時の索引書き込み(**既存処理の hook 化**。
   uploads ルートと delete ルートに直書きされている `indexUpsert` / `indexRemove` を移す)
2. `mediaFactsHook` — 画像(contentType が `image/*`)なら寸法を抽出して索引の行に書く

### 形 — `createRunner` を使わない理由を明記する

`FileTypePlugin` 等の拡張点は「どれか 1 つが担当する」(specific → broad の first-match)。
hook は「**全部が実行される**」。意味が直交するので `createRunner` は流用せず、明示配列 +
for-of で全実行する。これは「新しいディスパッチ形の発明」ではない — dispatch(担当決定)を
していないからである。順序は配列順(index → media。media は index が作った行に UPDATE する)。

```ts
// packages/api/src/hooks/object-hook/types.ts
export type ObjectHookEvent =
  | { readonly kind: 'uploaded'; readonly bucketId: string; readonly key: string; readonly env: Env }
  | { readonly kind: 'removed'; readonly bucketId: string; readonly key: string; readonly env: Env };

export type ObjectHook = {
  readonly id: string;
  run(event: ObjectHookEvent): ResultAsync<void, DriveError>;
};

// registry.ts — 明示配列。全 hook を順に実行する(first-match ではない)
export const objectHooks = [indexWriteHook, mediaFactsHook] as const satisfies readonly ObjectHook[];
```

- hook の失敗はリクエストを落とさない(現行の `indexUpsert` と同じ「索引は飾り」原則)。
  失敗は `console.error` + 続行。ただし **hook 同士は独立に実行**し、1 つの失敗で後続を
  スキップしない
- `mediaFactsHook` は `removed` では何もしない(行ごと消えるので)

## 5. バックフィル追い掛けフェーズ(既存画像の寸法埋め)

索引バックフィル(1 ページ 1000 件)に寸法抽出を同居させると、1 alarm で最大 1000 回の
R2 range read が走り、I3 で測った「読み取りブロック最大 3.2 秒」をさらに悪化させる。
**分離した追い掛けフェーズにする:**

- 索引バックフィルが `complete` に達したら、続けて media フェーズの alarm を予約する
- media フェーズ: `WHERE width IS NULL AND contentType LIKE 'image/%'` の行を
  **1 alarm あたり 50 件**抽出して UPDATE し、残りがあれば次の alarm を予約
- 進行状態は既存の meta パターン(`media_backfill_state` / カーソルは不要 —
  `width IS NULL` が残作業そのもの)。`status()` に media フェーズの残件数を足す
- 追い掛け中に削除された行は UPDATE 対象から消えるだけ(I3 の tombstone は索引本体の
  話であり、ここでは行が無ければ何もしないので安全)

## 6. ギャラリー UI

### 6.1 モード切替

- `b.$bucketId.$` の search param に `mode: 'tiles'` を追加(zod、optional は境界のみ)。
  **無指定 = ギャラリー**。ヘッダにトグル(react-aria `ToggleButtonGroup` または 2 つの
  リンク)を置き、既存の `?view=`(ビューア)とは独立に共存する
- 画像・動画 0 件(読み込み済みページ内に `isGalleryMedia`(contentType が `image/*` または
  `video/*`)が 1 件も無い)なら、タイル表示に自動フォールバックし、トグルは表示したまま

### 6.2 構造

```
┌──────────────────────────────────┐
│ photos / 2024 /      [ギャラリー|タイル] │ ← 既存ヘッダ + トグル
├──────────────────────────────────┤
│ ┌──┐┌────┐┌─┐                      │
│ │  ││    ││ │  画像+動画だけの skyline │ ← Virtualizer + GridList
│ └──┘│    │└─┘                      │    (SkylineLayout)
│ ┌────┐──┘┌───┐                     │
└──────────────────────────────────┘
```

フォルダと非メディアファイルはこの画面に現れない(§9)。ギャラリーは「画像+動画の壁」に
徹し、フォルダへ潜る・他ファイルを開くといった導線はタイルビューが引き受ける。

- **skyline セル**: 既存 GridList の行として画像 / 動画セルを描画。onAction → `?view=`
  (Phase 2 のビューアがそのまま開く)。選択・cmd+A・Delete・D&D 取り込みは GridList /
  Virtualizer の既存機能のまま
- **動画セル**: `<video preload="metadata" muted playsInline>` で先頭フレームをサムネイル
  として使う(controls は付けない — 再生は onAction で開くビューアの仕事)。動画は索引に
  寸法を持たない(§3.3 は image/* のみを probe する)ので ratio=1 の正方形セルになる。
  読み込み失敗時のフォールバック(アイコン + ファイル名)は画像と同じ

### 6.3 `SkylineLayout`(react-aria custom Layout)

- 参照実装の `pack.ts` / `compute-blanks.ts` を**テストごと移植**する
  (`layout.ts` の中身は wide 画像の span 判定 `spanForAspect` のみで、span=1 方針(§9)では
  使わないため移植しない)。
  純ロジックだが「apps/web のギャラリー専用」なので置き場所は
  `apps/web/src/routes/-components/gallery/skyline/`(packages/ に上げるのは 2 つ目の
  利用者が現れてから)
- `PackItem.ratio` = `media.kind === 'image' ? height / width : 1`、`span` = 常に 1
- 列数はコンテナ幅から: `columns = clamp(floor(width / MIN_COLUMN_PX), 2, 4)`、
  `cw = width / columns`。resize で再計算(`ssr: false` なので client 計測でよい)
- pack の placements(cw 単位)を px に換算して react-aria の `Layout` に渡す。
  `getVisibleLayoutInfos(rect)` は「rect と交差する placement」を返す — placements は
  ソート済み配列なので二分探索で絞れるが、**まず線形フィルタで実装して基準 1 の実測で
  判断**する(early optimization をしない)
- `GridListLoadMoreItem`(無限スクロールのセンチネル)は最下部(`totalHeight` 直下)に配置
- キーボードナビゲーション(`getKeyBelow` 等)は Layout の隣接判定に従う。skyline では
  「真下」が一意でないため、**列の重なりが最大のセルを次候補**にする(実装後に体感で調整)

## 7. エラーとフォールバック

| 事象 | 挙動 |
|---|---|
| 画像・動画の読み込み失敗 | セル内でアイコン + ファイル名にフォールバック(一覧の Preview と同じ思想)。pack の幾何は変えない(シフトさせない) |
| 寸法未抽出(`kind: 'none'`。動画は常にこれ) | ratio=1 の正方形セル。エラーではない |
| 索引なしバケット(`indexed: false`) | 全メディア ratio=1 で成立(ギャラリーは開ける)。media 追い掛けは索引済みバケットのみ |
| 抽出失敗 | `kind: 'none'` のまま。索引書き込みは成功させる(§3.3) |

## 8. テスト戦略

| 対象 | 方式 |
|---|---|
| `pack` / `layout` / `compute-blanks` | 参照実装のテストを移植(vitest) |
| `SkylineLayout`(可視範囲・load-more 配置・キー移動) | jsdom + 既存の browser geometry テスト系 |
| `MediaFacts` ワイヤ型(全経路が `media` を返す) | pool-workers(list / head / search の応答形) |
| 寸法抽出(png / jpeg / webp / gif の実バイト fixture、壊れた入力) | pool-workers |
| ObjectHook(アップロード → 索引 + 寸法が入る、削除 → 消える、hook 失敗の独立性) | pool-workers |
| media 追い掛けフェーズ(50 件ずつ進む、途中削除に安全) | pool-workers(既存 backfill テストのパターン) |
| モード切替・自動フォールバック・`isGalleryMedia` 判定・動画セル | jsdom |

## 9. 意図的に外したもの

| 外したもの | 理由 / いつやるか |
|---|---|
| サムネイル生成 | ObjectHook 3 実装目として後続。原寸 + immutable キャッシュで開始 |
| wide 画像の span 2 | 判定材料なし。使ってから決める |
| フォルダ導線をギャラリーに持たせること | ユーザー要望(2026-08-21)によりチップ列ごと撤去。
  ギャラリーは画像+動画だけの壁とし、フォルダへ潜る・他ファイルを開くにはタイルビューへ
  切り替える。ギャラリー自体は `folders` を一切受け取らない(`GalleryView` の props に
  `folders` / `onOpenFolder` が無い) |
| `/`(バケット一覧)のギャラリー化 | 全バケット横断クエリの設計が別途要る |
| blanks(参照実装の空きセル装飾) | `compute-blanks` は移植するが装飾は入れない。Drive は道具(design-direction の判断と同じ) |

## 10. 受け入れ基準

1. 画像入りフォルダを開くと**ギャラリーが既定表示**され、レイアウトシフトが起きない
   (寸法既知の画像は読み込み前から正しい比率で場所が確保されている)
2. `?mode=tiles` で従来のタイル一覧に切り替わり、切替後も選択・削除・ビューアが従来どおり動く
3. ギャラリーで画像をクリック(onAction)すると Phase 2 のビューア(`?view=`)が開き、
   ←/→ 移動・戻る 1 回クローズが機能する
4. ギャラリーでも 10,000 件スクロールがフレーム落ちしない(Phase 0 受け入れ基準 1 の維持。
   仮想化が効いていることを DOM ノード数で確認)
5. アップロード直後の画像が(リロード後)正しい縦横比でギャラリーに現れる(ObjectHook 経路)
6. バックフィル追い掛け完了後、既存画像が正しい縦横比になる。追い掛け中もギャラリーは
   ratio=1 で表示され続ける(壊れない)
7. 画像・動画 0 件のフォルダはタイル表示に自動フォールバックする
8. 動画セルが(先頭フレームのサムネイルで)ギャラリーに表示され、onAction で Phase 2 の
   ビューア(`?view=`)が開く
9. `indexed: false` のバケットでもギャラリーが開ける(全 ratio=1)
