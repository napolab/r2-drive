# `#foldersOf` の `EXPLAIN QUERY PLAN` 未計測を埋める

`docs/tasks.md`(190 行目)の持ち越し「`#foldersOf` の `EXPLAIN QUERY PLAN` 未計測。perf 実測は
フォルダのほぼ無い `perf/` で取っており、フォルダ数に比例する経路(`#foldersOf` の EXISTS 相関サブクエリ)
が 1 度も測られていない」を埋めるための計測記録である。

計測日: 2026-08-20
対象ブランチ: `fix/backfill-write-race`(調査時点。`#foldersOf` 自体は同ブランチの並行編集
(I3: バックフィルの書き込み競合修正)の対象外で、`upsert` / `remove` / `startBackfill` /
`#indexPage` / `#markFailed` のみが変わっている。`git diff` で確認済み)
参照した前回計測: [`2026-08-18-phase-1-index-perf.md`](./2026-08-18-phase-1-index-perf.md)

## 結論

**`#foldersOf` の EXISTS 相関サブクエリは、懸念されていた「フォルダごとのフルスキャン」ではない。
`objects` の PRIMARY KEY 由来の autoindex を使った範囲シークになっている。**
index.ts のコメント(「objects.key は PRIMARY KEY なので、この EXISTS は範囲スキャンで索引に乗る」)
は実測で裏付けられた。**索引の追加は不要。**

**ただし「インデックスに乗っている」ことは「フォルダ数に比例して遅くならない」ことを意味しない。**
実測では 1 リクエストあたり folder 数に応じて EXISTS を folder 数ぶん繰り返し実行するため、
**レイテンシは folder 数にほぼ線形に増える。** 100〜1,000 folders では 1ms 台だが、
5,000 folders で 5ms、10,000 folders で 8ms、20,000 folders で 16ms に達した。

**Phase 1 レポートが立てた「索引経路は R2 経路(15.58〜17.69ms)より速い」という基準は、
folder 数が約 20,000 件を超えるあたりで薄れ始める可能性がある**(ただし比較対象の R2 経路の
folder-数依存は本計測の対象外で測っていない。下記「この計測が言っていないこと」参照)。
**Phase 0 / Phase 1 で計測に使ったデータ(`perf/` 直下 10,000 件、フォルダはほぼ無し)はこの
軸を一切踏んでいなかった**ため、carry-over の指摘は正しかった。

**現時点で緊急の修正は不要と判定する。** 10,000 件規模のバケットで単一フォルダの直下に
20,000 個ものサブフォルダが並ぶのは Phase 0/1 が想定した利用形態(写真・ドキュメントの
フラットに近い置き方)からは外れる。ただし Phase 2 着手前に「1 フォルダに大量のサブフォルダを
作れる UI(バルクアップロードでの深いディレクトリ構造など)」を許すかどうかは設計判断が要る。
下の「修正案(未実装)」に打ち手をまとめた。

## 計測条件

|              |                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 環境         | `@cloudflare/vitest-pool-workers`(実 DO SQLite。`compatibilityDate: '2026-08-01'`、`useSQLite: true`)。macOS / darwin 25.4.0                                                                                                                                                               |
| 経路         | DO スタブへの直接 RPC(`stub.list(...)`)。HTTP の口(`GET /api/...`)は経由していない — Phase 1 レポートとの数字比較は「同じ土俵ではない」前提で読むこと(下記「言っていないこと」参照)                                                                                                        |
| 計測ファイル | 破棄済み scratch ハーネス(「使用したファイル」節参照。再構成手順は本文)                                                                                                                                                                                                                    |
| データ投入   | `runInDurableObject` の中で `objects` / `prefixes` に raw SQL で直接 INSERT(`upsert()` の RPC を 1 件ずつ叩かず、DO 内部から直接書く)。`objects_fts` は `#foldersOf` が触らないので投入していない                                                                                          |
| 手順         | ウォームアップ 2 回 → 計測 5 回 → 中央値(Phase 1 レポートと同じ手順)                                                                                                                                                                                                                       |
| SQL          | `#foldersOf`(index.ts L226-241、private)を手で複製して `EXPLAIN QUERY PLAN` を前置して実行。**呼べないので複製せざるを得ない** — 正しさは `stub.list()`(本番コードそのもの)が返す `folders` 件数が期待値と一致すること(100/1,000/5,000/10,000/20,000 件、全部一致)で間接的に裏取りしている |

## `EXPLAIN QUERY PLAN` の実測

複製した SQL(index.ts と同一):

```sql
SELECT prefix FROM prefixes
 WHERE parent_prefix = ?
   AND EXISTS (
     SELECT 1 FROM objects
     WHERE objects.key >= prefixes.prefix
       AND objects.key < substr(prefixes.prefix, 1, length(prefixes.prefix) - 1) || '0'
       AND objects.key <> prefixes.prefix
   )
 ORDER BY prefix
```

100 / 1,000 / 5,000 / 10,000 folders のどのデータ量でも **同じ形の plan** が出た(folder 数に
よらず plan の形は変わらない。深いネスト variant でも同じ):

| id  | parent | detail                                                                             |
| --- | ------ | ---------------------------------------------------------------------------------- |
| 4   | 0      | `SEARCH prefixes USING INDEX prefixes_by_parent (parent_prefix=?)`                 |
| 12  | 0      | `CORRELATED SCALAR SUBQUERY 1`                                                     |
| 16  | 12     | `SEARCH objects USING COVERING INDEX sqlite_autoindex_objects_1 (key>? AND key<?)` |
| 41  | 0      | `USE TEMP B-TREE FOR ORDER BY`                                                     |

読み方:

- **id 4**: 外側の `prefixes` 検索は `prefixes_by_parent` インデックス(`parent_prefix` 列)を
  使って絞り込む。ここは想定どおり。
- **id 16(parent = 12)**: 内側の相関 EXISTS は、`objects` の主キー(`key TEXT PRIMARY KEY`)が
  暗黙に作る autoindex(`sqlite_autoindex_objects_1`)を使った **範囲シーク**(`key>? AND key<?`)
  になっている。**`SCAN` ではない。** これが本レポートの中心的な発見であり、index.ts の
  コメントの主張と一致する。folder 1 件あたりのコストは「objects の全件を舐める」のではなく
  「B-tree を `O(log N)` で降りて範囲を辿る」で済んでいる。
- **id 41**: 外側の `ORDER BY prefix` に **一時 B-tree ソート**が必要になっている。
  `prefixes_by_parent` は `parent_prefix` 単一列のインデックスなので、`parent_prefix` の
  等値条件で絞った後の行が `prefix` 順に並んでいる保証を SQLite のプランナは持てず、
  明示的なソートを挟む。**これは folder 数に比例するコストの一部**(下記の補強実験参照)。

### 「補強インデックスを足したら変わるか」の非破壊実験

`objects(key)` 単体のインデックス(`sqlite_autoindex_objects_1` と等価な列構成)を
**このテストローカルの DO インスタンスにだけ**追加して比較した(`schema.ts` は変更していない。
CREATE INDEX はテストの `runInDurableObject` の中でのみ実行し、コミットしていない)。

| before                                                                             | after(`probe_objects_key` 追加後)                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `SEARCH objects USING COVERING INDEX sqlite_autoindex_objects_1 (key>? AND key<?)` | `SEARCH objects USING COVERING INDEX probe_objects_key (key>? AND key<?)` |

**plan の形(SEARCH + 範囲シーク)は変わらない。** プランナが選ぶインデックスの名前が
変わっただけで、コストの構造は同じである。**これは「index が無いから遅い」という仮説を
実測で否定する結果である**——objects.key に対する索引は既に(PK 由来で)存在し、使われている。

## Timing 実測 — folder 数依存

`list()` の 1 ページ目(`cursor: undefined`、`limit: 1000`)を、folder 数を変えた 5 通りの
データ形状で計測した(すべて総オブジェクト数はおおむね揃えるか、folder 数だけを伸ばした対照実験)。

| データ形状                     | folder 数 | 総 object 数 | 中央値(5 回) |  min |  max |
| ------------------------------ | --------: | -----------: | -----------: | ---: | ---: |
| (a) 100 folders × 100 objects  |       100 |       10,000 |      **1ms** |  0ms |  1ms |
| (b) 1,000 folders × 10 objects |     1,000 |       10,000 |      **1ms** |  1ms |  7ms |
| (c) 5,000 folders × 2 objects  |     5,000 |       10,000 |      **5ms** |  4ms |  9ms |
| (d) 10,000 folders × 1 object  |    10,000 |       10,000 |      **8ms** |  7ms | 10ms |
| (e) 20,000 folders × 1 object  |    20,000 |       20,000 |     **16ms** | 15ms | 17ms |

**folder 数を増やすと、総 object 数を変えなくても(a)→(d)の比較のとおりレイテンシが伸びる。**
(a)〜(d) は総 object 数を 10,000 件に揃えたまま folder 数だけを 100 → 10,000 に振っており、
**この 4 点の差は純粋に folder 数由来である。** (e) は folder 数をさらに倍にして傾向を確認した
追加点(総 object 数も 20,000 に増えているが、`#foldersOf` 自体は `objects` 全体ではなく
各 folder の範囲だけを見るので、object 数の増加そのものは各 folder あたりのコストにほぼ効かない
——1 folder あたり 1 object という設定はこれを確かめるため)。

**folder 数と中央値の関係はおおむね線形である**(5,000→10,000 で folder 数 2 倍・時間 1.6 倍、
10,000→20,000 で folder 数 2 倍・時間 2.0 倍)。1,000 folders までは 1ms 台のノイズに埋もれて
見えないが、それ以上では明確に効いてくる。

### Phase 1 レポートの基準線との突き合わせ

Phase 1 レポート(2026-08-18)が確立した基準線(HTTP 経由、`perf/` 10,000 件・フォルダほぼ無し):

| 経路                      | 中央値(20 回) |
| ------------------------- | ------------: |
| `indexed: false`(R2 経路) |      15.58 ms |
| `indexed: true`(索引経路) |       7.63 ms |

**本計測は DO への直接 RPC であり HTTP を経由していないので、数字をそのまま比較できない**
(Hono のルーティング・zValidator・シリアライズなどのオーバーヘッドが乗っていない分、
本計測のほうが速く出る方向にバイアスがかかる)。それでも参考として並べると:

- **フォルダがほぼ無い(Phase 1 の条件)場合、索引経路は 7-8ms 前後。**
- **本計測では、10,000 folders まで積み上げても 8ms で、Phase 1 の索引経路の基準線とほぼ同じ**
  ——つまり「folder 数を 10,000 まで増やしても、索引経路が Phase 1 で測った索引経路自身の
  基準線を大きく超えることはない」。
- **20,000 folders で 16ms に達する。** Phase 1 の R2 経路の基準線(15.58〜17.69ms)と
  **同じレンジに入る。** ここが「索引経路が R2 経路より優位でなくなり始める」目安である。
  ただし **R2 経路(`delimitedPrefixes`)の folder-数依存は今回測っていない**——R2 の
  delimiter 一覧も folder 数が多いページングでは遅くなる可能性があり、両方が同じように
  劣化するなら優位性は保たれたままかもしれない。**この突き合わせは行っていない。**

## 修正案(未実装、スケッチのみ)

現時点では上記のとおり「index が無い」問題ではないので、**インデックス追加という形の修正は
不要。** 代わりに、folder 数に比例するコストそのものを減らすなら次の 2 段階が考えられる。

### 案 1(小さい): `prefixes_by_parent` を複合インデックスにして `ORDER BY` の一時ソートを削る

```ts
// schema.ts のイメージ。実装しない。
index('prefixes_by_parent').on(table.parentPrefix, table.prefix);
```

`parent_prefix` の等値条件で絞った後の行が `prefix` 昇順で既にインデックス順になることを
プランナに伝えられれば、`USE TEMP B-TREE FOR ORDER BY` が消える可能性がある。
**ただし EXISTS 側の相関サブクエリ実行回数(= folder 数)そのものは減らない**ので、
効果は「定数倍の削減」に留まり、線形の伸びそのものは残る。**実測で効果を確認してから
入れる価値があるかどうかを判断すること**(このレポートでは試していない)。

### 案 2(大きい): 「空でないフォルダ」を書き込み時に維持する

現状は読み取りのたびに EXISTS で「配下に objects が 1 件でもあるか」を folder 数ぶん
再計算している(Ruling 2 の設計そのもの)。これを `upsert` / `remove` の側で
`prefixes` テーブルに `has_objects`(または参照カウント)列を持たせて増減させれば、
`#foldersOf` は `SELECT prefix FROM prefixes WHERE parent_prefix = ? AND has_objects`
のような単純な等値条件クエリになり、**folder 数に比例する相関サブクエリの実行がゼロになる。**

トレードオフ: `remove` のたびに「他に兄弟オブジェクトが残っているか」を確認する分だけ
書き込み側のコストが増える(現状 `remove` は `prefixes` を一切触らない設計。上のコメント
「remove は prefixes 行を消さない」を参照)。**読み取りが多く書き込みが少ないアクセスパターン
(Drive の典型的な使い方)なら妥当な交換だが、設計変更として別タスクで扱うべき規模である。**

いずれも **このレポートでは実装していない。** 「folder 数が線形にレイテンシへ効く」ことを
実測で確認したのがこのレポートの役目であり、対処が要るかどうかは Phase 2 着手前に
数値を見て判断する材料として残す。

## この数字が言っていないこと

- **DO への直接 RPC であって HTTP 経由ではない。** Hono のルーティング / zValidator /
  JSON シリアライズのオーバーヘッドが乗っていないので、Phase 1 レポートの HTTP 実測と
  単純比較はできない。
- **`indexed: false`(R2 経路)の folder-数依存は測っていない。** 索引経路が folder 数に
  比例して遅くなることは実測したが、比較相手の R2 `delimitedPrefixes` が同じ軸でどう
  振る舞うかは未計測。「20,000 folders で優位性が薄れる」という言い方は、索引経路単体の
  レイテンシが Phase 1 の R2 基準線に近づくという意味であり、**その時点の R2 経路自身を
  測り直したわけではない。**
- **データ投入は `upsert()` の RPC を 1 件ずつ叩く代わりに、DO 内部から raw SQL で直接
  `objects` / `prefixes` に INSERT した。** `#foldersOf` の計測が目的で `upsert()` /
  バックフィル自体の速度は測っていないため、この省略は測定対象に影響しない
  (`objects` / `prefixes` の行の形は `upsert()` が作るものと同一)。ただし `objects_fts`
  には書いていないので、この計測データで `search()` を叩くと意図しない結果になる
  (このレポートでは `search()` は測っていないので実害はない)。
- **10,000 / 20,000 という folder 数が現実的かは未検証。** Phase 0/1 が seed した実データは
  `perf/` 直下 10,000 件のフラットなオブジェクトで、1 フォルダにこれほど大量の直下
  サブフォルダを作る運用が実際に起きるかは、Drive の UI 設計(バルクアップロード時の
  ディレクトリ構造をどこまで許すか)に依存する。
- **`EXPLAIN QUERY PLAN` の SQL は index.ts から手で複製したものである。** private メソッド
  なので直接は呼べず、`stub.list()`(本番コードそのもの)が返す folder 件数が期待値と
  一致することで間接的に裏取りしているが、**テキストとしての完全一致を機械的に保証しては
  いない。** index.ts の `#foldersOf` を変更するときはこのレポートの SQL も合わせて
  読み直すこと。

## 使用したファイル

- 計測ハーネス(`packages/api/test/foldersof-explain.scratch.test.ts`)は**計測後に破棄した。**
  production のコーディング規約を意図的に緩めた scratch であり、20,000 フォルダの seed を
  含むため CI(`pnpm test`)に常駐させる価値が無いと判断した。再現する場合は本文の
  「計測方法」節にある SQL・seed 形状・計測手順(2 回ウォームアップ + 5 回計測の中央値、
  `runInDurableObject` で raw SQL seed → `stub.list()` を RPC で計測)から再構成すること。
  `packages/api/src/object-index/index.ts` / `schema.ts` / 既存の `packages/api/test/*` は
  一切変更していない。
