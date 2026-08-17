# r2-drive Phase 1 設計 — オブジェクト索引と検索

Phase 0 の設計は [`2026-08-14-r2-drive-design.md`](./2026-08-14-r2-drive-design.md)(以下 Phase 0 spec)。
本書はその Phase 1 を実行可能な粒度に落としたものであり、**Phase 0 spec の記述を 2 箇所上書きする**(§10 参照)。

計測の根拠は [`reports/2026-08-17-task-16-perf.md`](../../../reports/2026-08-17-task-16-perf.md)。

## 1. 目的

Phase 0 spec §1 の痛点のうち、`R2.list()` の構造的限界に由来する 2 つを解く。

| 痛点 | 原因 | Phase 1 で解くか |
|---|---|---|
| 1 フォルダ 1000 件超で一覧が遅い | `R2.list()` はカーソル走査しかできない | **解く** |
| 検索が使い物にならない | `R2.list()` に検索が無い | **解く** |
| サムネイルが無い | 派生ファイルの索引が無い | **解かない**(§9 参照) |

**R2 が真実であるという原則は崩さない。**索引は後付けの読み取り加速層であり、
索引を信じないバケットは Phase 0 と同じ経路で一覧が出続ける。

### 非目的

Phase 1 は**受け入れ基準 1(10,000 件のスクロールでフレーム落ちしない)を解かない。**
計測により、フレーム落ちの原因が「1 ページ追加のたびにクライアント側のコレクション全体が
作り直されていること」であると判明している。索引で速くなるのは list の応答であって、
クライアント側の再構築ではない。**この 2 つを混同しないこと。**

## 2. 決定事項

各決定は「何を選んだか」と「何を捨てたか」を対で記録する。捨てた理由が失われると再検討できない。

| # | 決定 | 捨てたもの |
|---|---|---|
| 1 | 索引は **Durable Object の SQLite**。1 バケット = 1 DO | **D1**(§3) |
| 2 | 追加 binding は **`OBJECT_INDEX` の 1 つだけ** | Queue / IMAGES(§9) |
| 3 | Phase 1 の範囲は **索引と検索だけ** | サムネイル / `ObjectHook` / `runAll` / `MediaFacts`(§9) |
| 4 | 索引の信頼判定は **deploy 時の設定**(`bucketDescriptors.indexed`) | 実行時の readiness 問い合わせ(§6) |
| 5 | DO は **小さい基底クラスを `extends`** して機能を足す | 単一の巨大クラス(§5) |
| 6 | クエリは **Drizzle の `durable-sqlite`** | raw `sql.exec` / Kysely(§4) |
| 7 | FTS5 は **upsert と同じ書き込み経路で明示的に更新** | SQLite trigger / external content 方式(§4) |

## 3. なぜ D1 ではなく Durable Object か

Phase 0 spec §5.2 と `docs/tasks.md` は Phase 1 を「D1 索引」と書いていた。**これを変更する。**

| | D1 | **DO SQLite(採用)** |
|---|---|---|
| 追加 binding | `d1_databases` + Queue 2 種 = 3 | **1** |
| サイズ上限 | 10 GB **総量**(引き上げ不可) | **10 GB / バケット** |
| 書き込みの原子性 | 別クエリ。索引と FTS の不整合の余地あり | **同一トランザクションに束ねられる** |
| リトライ機構 | Queue(別インフラ) | **`alarm()` が内蔵**(at-least-once / 指数バックオフ) |
| 同時 upsert の競合 | 設計が必要 | **単一 writer で原理的に起きない** |
| 読み取りレイテンシ | 読取レプリカあり | **リージョン固定** |
| 書き込みスループット | 高い | **1 バケットで直列化** |

**採用理由は binding 数だけではない。**

1. **10 GB の上限問題が設計を足さずに消える。**D1 は総量 10 GB でシャーディング機構の自作が必要になるが、
   DO は 1 バケット 10 GB なので `idFromName(bucketId)` だけで分割が済む
2. **Durable Object はこの製品に必ず来る。**Phase 0 spec §14 と CLAUDE.md の ref repository
   (`y-durableobjects` / `durabcast`)のとおり Phase 3 の共同編集は DO 前提である。
   Phase 1 で DO を導入する学習コストは Phase 3 で回収される
3. **決定 7(FTS5 を明示的に書く)の唯一の弱点が構造的に消える。**「片方だけ書けて不整合になる」が
   単一トランザクションで起きなくなる

### 受け入れた代償

- **リージョン固定。**DO は 1 箇所に住むので遠方からの一覧はレイテンシを払う。
  本製品は Cloudflare Access 配下の個人用ツールであり、実害は小さいと判断した
- **1 バケットへの書き込みが直列化する。**大量アップロード時に索引書き込みが順番待ちになる。
  ただし順序と原子性が保証される方が望ましい場面でもある

### R2 SQL を採用しなかった理由

検討した(2026-08-17)。**一覧を返す経路には使えない。**

- **Workers binding が無い。**REST(`api.sql.cloudflarestorage.com`)か wrangler CLI のみ。
  Worker から使うと毎回の一覧が外部 HTTPS サブリクエストになり、bearer token を secret で持つ必要がある
- **書き込みが Pipelines 経由の append 中心。**列に `__ingest_ts` が付くイベントログの形であり、
  ファイルの上書き(UPDATE)と削除(DELETE)が自然に書けない。索引は R2 の現在状態を映す必要がある
- **全文検索が無い。**FTS5 を前提とした決定 7 が成立しない
- **分析エンジンである。**Iceberg の Parquet をスキャンする設計であり、点引きをミリ秒で返す道具ではない
- open beta

**将来の用途としては残す。**アクセスログの分析、全バケット横断の棚卸し、Phase 6 のトランスコード実績集計は
いずれも「大量・追記のみ・秒単位で良い」という R2 SQL の性格に合う。**Phase 1 の対象外という位置づけである。**

## 4. スキーマ

**1 バケット = 1 DO なので、表に `bucket_id` 列を持たない。**

```sql
CREATE TABLE objects (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,   -- key の最後のセグメント
  parent_prefix TEXT NOT NULL,   -- 末尾の '/' まで。フォルダ内の列挙に使う
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  uploaded_at   TEXT NOT NULL,   -- ISO8601
  etag          TEXT NOT NULL
);
CREATE INDEX objects_by_folder ON objects (parent_prefix, key);

-- R2 の delimitedPrefixes に相当するものを実体化する
CREATE TABLE prefixes (
  prefix        TEXT PRIMARY KEY,  -- 末尾 '/' 込み
  parent_prefix TEXT NOT NULL
);
CREATE INDEX prefixes_by_parent ON prefixes (parent_prefix);

CREATE VIRTUAL TABLE objects_fts USING fts5(key, name);

CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);  -- バックフィルのカーソル
```

### `prefixes` を実体化する理由と、それが招く誘惑

R2 では「フォルダ」は `list({ delimiter: '/' })` の副産物でしかない。だから Phase 0 spec §9.5 は
「空のフォルダは表現できない」と書いている。

索引が `prefixes` を持つと**空フォルダが表現可能になる。**
**しかし Phase 1 ではフォルダ作成を提供しない。**索引済みバケットだけ空フォルダが作れて
索引なしバケットでは作れない、という非対称な状態を生むためである。
フォルダ作成を入れるなら、索引の有無に依存しない形で別途設計する。

### FTS5 の更新を明示的に書く理由

trigger でも external content 方式でも自動同期はできるが、**挙動がスキーマに隠れてテストで追いにくくなる。**
`objects` を書き換える場所で `objects_fts` も書く。書き忘れは**テストで封じる**(§8)。

決定 1(DO)により `objects` / `prefixes` / `objects_fts` の更新は同一トランザクションになるため、
「片方だけ書けて不整合になる」という明示更新の弱点は構造的に消えている。

### Drizzle を選んだ理由

npm を調査した(2026-08-17)。

| 候補 | 状態 |
|---|---|
| `kysely-do` | **`0.0.1-rc.1` / 最終更新 2025-06-01 / 11KB / 個人リポジトリ。**依存できない |
| `kysely-d1` | D1 用。DO には使えない |
| Kysely 本体 | 健全だが **DO 用の公式 dialect が無い**。自作は「車輪の再発明」に該当する |
| **`drizzle-orm`** | **0.45.2 / 2026-08-12。`./durable-sqlite` `./durable-sqlite/migrator` を一次サポート** |

**検証済み**(§7、2026-08-17 実測): Drizzle の `await db.insert(...)` を連続で呼んだとき、
Cloudflare が言う write coalescing(`await` を挟まない `sql.exec()` が 1 トランザクションになる)が
保たれるかを `packages/api/test/drizzle-atomicity.test.ts` で確かめた。**保たれなかった**
(1 本目が成功し 2 本目が失敗する連続 `sql.exec` を流したところ、1 本目は巻き戻らず残った)。
**書き込み経路は `this.ctx.storage.transactionSync()` で明示的に囲う。**決定 1(`objects` /
`prefixes` / `objects_fts` を同一トランザクションで更新する)の前提はこれで満たす。

## 5. Durable Object のクラス構成

**小さい基底クラスを `extends` して機能を足す。**

```
DurableObject<Env>            (cloudflare:workers)
      ▲
SqliteStore                   スキーマ適用と Drizzle インスタンスの保持だけ
      ▲
ObjectIndex                   upsert / remove / list / listFolders / search / backfill
```

```ts
// packages/api/src/index-do/sqlite-store.ts
export class SqliteStore extends DurableObject<Env> { ... }

// packages/api/src/index-do/index.ts
export class ObjectIndex extends SqliteStore { ... }
```

### この形が成立する根拠

Workers RPC が公開するのは **prototype chain 上のもの**である。公式ドキュメントは
「arrow function は**クラスの prototype ではなくインスタンスに定義されるため** RPC で公開されない」と
説明している。したがって `class B extends A` は A のメソッドを prototype chain に載せるので、
**継承したメソッドはそのまま RPC で公開される。**

**これにより `.claude/rules/function-style.md` の「class method は arrow property ではなく
method shorthand で書く」は、本リポジトリでは単なるスタイル規約ではなく RPC が動くための必須条件になる。**
arrow property で書いた瞬間に stub から呼べなくなる。

### 守るべき制約

| | |
|---|---|
| `migrations` の `new_sqlite_classes` に書くのは**具象クラス名だけ** | `["ObjectIndex"]`。中間クラスは登録しない |
| 基底が `alarm()` / `fetch()` を持つ場合、override 時に `super` を呼ぶ | 基底の後処理を落とさないため |
| 状態をインスタンスの arrow property に持たない | RPC から見えなくなる |
| インスタンスプロパティは RPC から読めない。**公開したい値は getter にする** | 同上 |

### 依存方向

DO クラスは `packages/api` に置く(`packages/*` は Workers グローバルを import しない、
ただし `packages/api` は例外 — Phase 0 spec §11)。`apps/web/src/worker.ts` が
`export { ObjectIndex } from '@r2-drive/api'` で再輸出する。
**`worker.ts` は「Hono アプリと DO クラスを合成する唯一の場所」になる。**

## 6. 経路

```
【書き込み】
  アップロード完了 ─▶ R2 put ─▶ await stub.upsert(descriptor) ─▶ 200
  削除           ─▶ R2 delete ─▶ await stub.remove(key)

【読み取り】
  GET /buckets/:id/objects?prefix&cursor
      ▼
  resolveObjectSource   (createRunner / first-match / 順序に意味がある)
      ├─ [0] indexedSource   bucketDescriptors.indexed が true のバケットだけ ok
      │                        └─▶ stub.list()
      └─ [1] r2ListSource    常に ok(受け皿)
                               └─▶ R2.list()   ← Phase 0 のまま

  GET /buckets/:id/search?q&cursor  ─▶ stub.search(q)
```

**索引書き込みを同期 RPC にしたのは 1 INSERT で足りるからである。**結果として
「アップロードしたのに一覧に出てこない」問題が発生せず、クライアント側の楽観的挿入も不要になる。

### 索引を信じるかどうかは deploy 時に決める

`Processor<I, O>.run` は同期で `Result<O, I>` を返す(Phase 0 spec §5.1。
「ディスパッチは同期、仕事は非同期」)。**しかし「索引が ready か」は DO に問い合わせないと分からない
非同期の状態であり、同期ディスパッチの中で判定できない。**

したがって **readiness を実行時の状態ではなく deploy 時の設定にする。**
`packages/api/src/r2/registry.ts` の `bucketDescriptors` に `indexed: boolean` を持たせる。

```
バックフィルを起動 ─▶ status() を見て完了を確認 ─▶ indexed: true にして deploy
```

**受け入れた代償**: 実行時に索引が壊れたとき、R2 経路に戻すには deploy が必要になる。
自動復帰は持たない。代わりに「部分的な一覧を返す」ことが原理的に起きない
(**部分的な一覧は空の一覧より危険である。消えたことに気付けない**)。

### ページングのワイヤ互換

D1 / DO では keyset pagination(`WHERE key > ? ORDER BY key LIMIT ?`)になるが、
**ワイヤ型 `NextPage` は変わらない。**`{ kind: 'more', cursor }` の cursor が
「R2 の opaque token」から「最後の key」に変わるだけで、クライアントは何も知らなくてよい。
**Phase 0 で `ObjectSource` を作っておいた投資が効く箇所である。**

`ObjectDescriptor` も変更しない(§9 で `MediaFacts` を外したため)。**クライアントの変更はゼロ。**

## 7. バックフィル

DO の `alarm()` が R2 を 1 ページずつ舐め、カーソルを `meta` に置く。
**`alarm()` を使うのはここ 1 箇所だけである。**

- 1 回の alarm で 1 ページ(`R2.list()` の上限 1,000 件)を処理し、次の alarm を予約する
- 途中で失敗しても、カーソルが残っているので再実行で続きから進む
- `alarm()` は at-least-once・指数バックオフ(初回 2s、最大 6 回)。**組み込みの 6 回で尽きるので、
  無限リトライが要る場合は handler 内で例外を捕まえて `setAlarm()` を貼り直す**
- 進捗は `status()` で読めるようにする。運用者が完了を確認して `indexed: true` に切り替える

**冪等でなければならない。**同じキーを 2 度処理しても結果が変わらないこと(upsert であること)。

### 起動と観測の経路

運用者が触るための口を 2 つ用意する。**どちらも Cloudflare Access の背後にあるので、
アプリ側に権限の概念を持ち込まない**(Phase 0 spec の「認証は Access に寄せる」を維持)。

| 口 | 形 | 返すもの |
|---|---|---|
| 起動 | `POST /buckets/:bucketId/index/backfill` | `202` + 現在の `status` |
| 観測 | `GET /buckets/:bucketId/index/status` | 下記の variant |

```ts
export type BackfillStatus =
  | { readonly kind: 'idle' }                                        // 一度も走っていない
  | { readonly kind: 'running'; readonly indexed: number }            // 進行中
  | { readonly kind: 'complete'; readonly indexed: number }           // 完走した
  | { readonly kind: 'failed'; readonly indexed: number; readonly reason: string };
```

**`indexed: true` への切り替えを API から行わない。**設定を実行時に書き換えられるようにすると
「deploy 時の設定である」という決定 4 の性質が崩れ、同期ディスパッチの前提が失われる。
切り替えは `bucketDescriptors` の編集と deploy で行う。

## 8. テスト戦略

`@cloudflare/vitest-pool-workers` で本物の DO 相手に走らせる。

- **DO を直接叩くテスト** — upsert / remove / list / listFolders / search / backfill
- **API 経由の統合テスト** — `indexed: true` / `false` の両方で `GET /objects` が正しく振る舞うこと
- **索引を意図的に壊した状態で一覧が出ること**を固定する(Phase 0 spec §5.4 の要求)。
  ただし決定 4 により、これは「`indexed: false` なら R2 経路に落ちる」の検証になる
- **FTS5 の更新漏れを封じるテスト** — `upsert` / `remove` の後に `search` の結果が追随すること。
  決定 7(明示更新)の弱点をここで塞ぐ
- **カーソル往復** — 全ページを繋ぐと投入した全キーが重複なく揃うこと

**注意**: `@cloudflare/vitest-pool-workers` のストレージ分離は**テストファイル単位**である
(vitest 4 で `isolatedStorage` オプションは削除された)。同一ファイル内のテスト間で
書き込みは巻き戻らないので、テストごとに別の DO id か別 prefix を使う。

## 9. 意図的に Phase 1 から外したもの

**すべて「今やらない理由」を添えて記録する。**理由が失われると、後から誰かが「なぜ無いのか」で悩む。

| 外したもの | 理由 |
|---|---|
| **サムネイル生成** | Phase 1 の目的(一覧の速さと検索)に不要。**本当に要るのは Phase 4 の skyline ギャラリー** |
| **`ObjectHook` 拡張点** | サムネイルを外すと実装が「索引書き込み」1 つになる。**「拡張点を作ってよいのは導入時点で実装が 2 つ以上あるときだけ」**(CLAUDE.md)に反する |
| **`runAll`(fan-out ディスパッチ)** | 上と同じ。`ObjectHook` が無いので `packages/core` への追加は不要 |
| **Cloudflare Queues** | 索引書き込みが 1 INSERT で済むため同期 RPC で足りる。耐久性が要るのはバックフィルだけで、そこは `alarm()` が担う |
| **`IMAGES` binding** | サムネイルを外したため。`MediaFacts` の幅・高さもこれ経由なので同時に外れる |
| **`MediaFacts`** | 上記により Phase 1 では埋められない。**結果として `ObjectDescriptor` のワイヤ型が変わらず、クライアントの変更がゼロになる** |
| **空フォルダの表現** | `prefixes` により技術的には可能になるが、索引の有無で挙動が非対称になる(§4) |
| **R2 SQL** | §3 参照。分析用途の将来の選択肢として残す |
| **Vectorize(意味検索)** | Phase 0 spec §14 のとおり、FTS5 を実際に使ってから要否を判断する |

### サムネイルと `ObjectHook` を入れる条件

**次の 2 つが同時に揃ったとき。**

1. サムネイル生成(`IMAGES.input().transform()`)
2. もう 1 つの後処理 — 現実的には `MediaFacts` の抽出(`IMAGES.info()`)か、Phase 6 の動画尺抽出

そのとき初めて `ObjectHook` の実装が 2 つになり、拡張点の導入根拠が立つ。
**課金は障壁ではない。**`IMAGES.info()` は常に無料、変換は月 5,000 unique まで無料で、
同じ画像 + 同じパラメータは月内 1 回しか課金されない(§11)。**外した理由は複雑さである。**

## 10. Phase 0 spec の上書き

本書は Phase 0 spec の次の記述を上書きする。

| Phase 0 spec | 記述 | 本書での扱い |
|---|---|---|
| §5.2 の表 | `ObjectHook` を Phase 1 で導入する | **Phase 1 では導入しない**(§9) |
| §5.2 / §14 | Phase 1 の索引は D1 | **Durable Object の SQLite**(§3) |

Phase 0 spec §14 の未決事項「`ObjectHook` に `hookable` を使うか自作するか」は、
**`ObjectHook` 自体を後倒しにしたため未決のまま持ち越す。**判断は §9 の条件が揃ったときに行う。

## 11. 課金

個人利用規模(10,000 オブジェクト)での見積もり。Workers Paid($5/月)の included 枠に収まる。

| 項目 | 使用量 | 無料枠 | 追加費用 |
|---|---|---|---|
| DO リクエスト(索引書込 + 一覧 + alarm) | 数万 | 100 万/月 | $0 |
| DO duration | 僅少 | 400,000 GB-s/月 | $0 |
| DO SQLite 行書込 | 10,000 | 5,000 万/月 | $0 |
| DO SQLite 行読取 | 数十万 | 250 億/月 | $0 |
| DO SQLite ストレージ | ~5 MB | 5 GB | $0 |

**Phase 1 の追加コストは実質ゼロである。**

## 12. 着手前に検証するリスク

**実装計画の最初の 2 タスクをこれにする。**どちらも falsy だった場合に設計の一部を組み直す必要がある。

| # | 検証すること | falsy だった場合 |
|---|---|---|
| 1 | **DO SQLite で FTS5 が使えるか。**2026-08-17 に実測、DO SQLite で FTS5 は使える(`packages/api/test/fts5-availability.test.ts`。`CREATE VIRTUAL TABLE ... USING fts5(name)` から `MATCH` クエリまで通った) | 検索の設計だけ組み直す(`name LIKE ?` か別手段)。**索引の速さは影響を受けない** |
| 2 | **Drizzle の `await` 連鎖で write coalescing が保たれるか**(§4)。2026-08-17 に実測、**保たれない**(`packages/api/test/drizzle-atomicity.test.ts`。2 本目が失敗しても 1 本目は残り、行数は 1 になった) | 書き込み経路は `this.ctx.storage.transactionSync()` で明示的に囲う。raw `sql.exec` を連続で呼ぶだけでは不十分 |

## 13. 受け入れ基準

1. 索引済みバケットで 10,000 件のフォルダの 1 ページ目が `R2.list()` 経路より速く返る(実測して数字を出す)
2. ファイル名の部分一致検索が 10,000 件から返る
3. **`indexed: false` のバケットが Phase 0 と完全に同じ挙動をする**(回帰が無い)
4. 索引を意図的に壊した状態でも `indexed: false` なら一覧が出る
5. `upsert` / `remove` の後に `search` の結果が追随する(FTS5 の更新漏れが無い)
6. バックフィルを途中で止めて再実行すると、続きから進んで全件揃う
7. `ObjectDescriptor` と `NextPage` のワイヤ型が変わっていない(クライアント無変更)
