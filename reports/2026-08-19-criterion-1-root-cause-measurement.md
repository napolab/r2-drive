# 受け入れ基準 1 — コンポーネント境界ごとの性能計測(原因の切り分け)

`reports/2026-08-17-task-16-perf.md` で「1 ページ追加のたびにコレクション全体が O(n) で
作り直される」という仮説が立ったが、実装を読んで確かめられていなかった。本書はその確認である。
**修正は行っていない。原因の特定のみ。**

計測日: 2026-08-19
対象コミット: `main` (`3f9537d`)

## 結論(先に)

- **支配的だったのは react-aria-components 内部のコレクション再構築(仮説 B/C 側)。** 自己時間の
  内訳で 1〜3 位は「未帰属(other, 34%)」「V8 native/GC(17%)」「DOM mutation(15%)」の次に
  **`Virtualizer`/`GridLayout` の再レイアウト(14%)」「react-aria の `BaseCollection.clone`/`addNode`
  および `useGridListItem`(12%)」が続く。この 2 つはページ読み込み直後の 500ms 窓に集中しており
  (定常時 21.2% → ページ読み込み後 31.1%)、**ページングと明確に結びついている**
- **仮説 A(ページングが無い普通のスクロールフレームが件数に比例して重くなる)は、今回測れた範囲
  (約 1,000 件→約 3,200 件)では確認できなかった。** 定常フレームの p95 は 2.19ms → 2.61ms
  (+19%)で、3.2 倍の件数増加に対して緩やかにしか伸びていない。「毎フレーム全 LayoutInfo を
  線形走査する」ような処理が支配的なら自己時間の目立つ bucket として出るはずだが、
  スクロール/可視矩形系の自己時間は終始 0.1% しかなかった
- **我々のコード(`flatMap` ×2, `rows` の `map`, `objectsByRowId` の `Map` 構築)自体の自己時間は
  終始 0.0〜0.1% で、測定可能な支配要因ではなかった。** ただし**これらが「新しい配列を作る」ことで
  `Row` オブジェクトの参照同一性を毎ページ壊しており、それが react-aria-components 側の
  差分更新(WeakMap キャッシュ・dirty ノード追跡)を無効化して、react-aria 自身の内部処理を
  O(現在の総件数) で毎回やり直させている**、という因果関係をソースコード側から特定した(後述)
- **仮説への判定: 「react-aria のコレクション構築が支配的」が正しいが、それを引き起こしているのは
  我々の 3 つの O(n)。** 二者択一ではなく、**我々の O(n) → react-aria 側の O(n) を誘発、という
  連鎖**が実体である
- **測れなかったこと:** headless Chromium (Playwright) は実ブラウザよりも高速で、かつ CDP trace の
  バッファが約 4.2 秒(件数にして約 1,000→3,200 件)で頭打ちになり、それ以降(〜10,000 件)の
  詳細な self-time は取得できなかった。50ms 超の long task も今回の計測範囲では 3 本しか
  観測できておらず、報告にある 116.4ms 級の p95 long frame は再現できていない

## 計測方法

### 環境

- `pnpm --filter web dev`(port 5173)。ローカル R2 に残っている 10,000 件の seed データ
  (`apps/web/.wrangler/state/v3/r2`, prefix `perf/`)をそのまま使用。作り直していない
- 対象 URL: `http://localhost:5173/b/photos/perf/`(`photos` は `indexed: true`)

### Chrome DevTools MCP が使えなかった

`mcp__chrome-devtools__new_page` を呼んだところ
`The browser is already running for .../chrome-devtools-mcp/chrome-profile` で失敗した。
調査すると、**別セッションの `claude` プロセス(12 時間起動中、pid 43075 系列)が同じ
デフォルトプロファイルディレクトリで Chrome を握っていた。** これは他セッションの作業中の
ブラウザであり、落とすと他作業に影響するため、殺さずに代替手段に切り替えた。

### 代替: Playwright 直叩きによる CDP trace 取得

`node_modules/playwright`(1.62.1、Chromium 同梱)を使い、`chromium.launch()` →
`context.newCDPSession(page)` → `Tracing.start` / `Tracing.end` で生トレースを直接取得した。
一時スクリプトは `apps/web/.scratch-*.mjs` として置いて実行後に削除し、都度 `git status` を
クリーンな状態に戻している(最終確認も後述)。

取得したカテゴリ: `devtools.timeline`, `disabled-by-default-devtools.timeline(.frame/.stack)`,
`disabled-by-default-v8.cpu_profiler(.hires)`, `v8.execute`, `blink.user_timing`, `loading`,
`latencyInfo`(`recordAsMuchAsPossible`)。

手順:

1. `http://localhost:5173/b/photos/perf/` を開き、初回描画を待つ
2. `Tracing.start`
3. ページ内 `evaluate()` で、Virtualizer のスクロールルート(`overflow: auto` を持つ要素を
   `getComputedStyle` で探索して特定)に対し、rAF ループで `scrollTop += clientHeight/3` を
   30 秒間加算し続ける(底に着いたらブラウザが自動的にクランプするので、そのまま留まって
   `GridListLoadMoreItem` の `onLoadMore` が発火し続ける)
4. `Tracing.end` → `IO.read` でストリームを読み出し `trace2.json`(240MB)として保存
5. 生トレースを独自スクリプトで解析(後述)

平行して、CPU profile 無しの軽量な計測(`calibrate-growth.mjs`)も走らせ、`role="grid"` 要素の
`aria-rowcount` 属性(react-aria が自分で保持している総件数)を 1 秒おきに読み、
**実際に 10,000 件超までページングが進むこと自体は確認済み**(t=16.3s で `rowcount=10000`)。

### トレース解析

`analyze-final2.mjs` で以下を実施:

- `Profile` / `ProfileChunk` イベント(CPU profiler のサンプル)を `pid` で束ね(**注: tid は
  CPU profiler 専用の別スレッド ID になっており、`CrRendererMain` の tid とは一致しない。
  ここで最初つまずいた**)、V8 コールフレームの `functionName`/`url`/`lineNumber` で自己時間を集計
- トップレベルの `RunTask`(`ph:'X'` の完了イベントのうち、他のイベントにネストされていないもの)を
  1 フレームの作業単位として抽出
- `ResourceSendRequest`/`ResourceFinish` から `/objects?cursor=...` への実リクエストを検出し、
  **応答完了時刻から 500ms を「ページング窓」、それ以外を「定常スクロール窓」として分類**
- Vite の pre-bundle (`apps/web/node_modules/.vite/deps/react-aria-components.js`) を直接読み、
  minify された export 名(`$xxxxx$export$yyyyy`)が実際にどの関数かを特定

## 発見: バッファが約 4.2 秒で頭打ちになった

30 秒スクロールし続けたにもかかわらず、`trace2.json` 内の `RunTask` も CPU profile サンプルも
**scroll ループ開始(`tick` 関数の最初のサンプル)から約 4.14 秒分しか記録されていなかった。**
このため、詳細な self-time 解析ができたのは **件数が約 1,000 → 約 3,200 に育つ区間のみ**である
(この間に実際に発生したページ読み込みは 2 回、`cursor=...00999...` と `cursor=...01999...`)。
`recordAsMuchAsPossible` を指定しても、`disabled-by-default-v8.cpu_profiler.hires` や
`.timeline.stack` のような高頻度カテゴリを同時に有効にするとバッファがすぐ埋まる。
**次回計測するなら、カテゴリを絞るか `streaming` モードで分割保存する必要がある。**

## 長いフレームのコールツリー(self time 上位)

計測できた約 4.2 秒(9,719 フレーム)全体での自己時間内訳:

| 順位 | self time | 割合  | 内容                                                                             |
| ---- | --------- | ----- | -------------------------------------------------------------------------------- |
| 1    | 1375.1ms  | 33.7% | 未帰属(`(anonymous)` / URL 無しの最適化フレームなど、個別に特定できなかったもの) |
| 2    | 672.1ms   | 16.5% | V8 native / GC / idle                                                            |
| 3    | 620.4ms   | 15.2% | DOM mutation(`removeChild` / `appendChild`。Virtualizer のマウント/アンマウント) |
| 4    | 566.3ms   | 13.9% | `Virtualizer` / `GridLayout` の再レイアウト(`measure` / `run`)                   |
| 5    | 499.1ms   | 12.2% | react-aria `BaseCollection.clone` / `addNode`、`useGridListItem`                 |
| 6    | 342.5ms   | 8.4%  | React 要素生成(`createElement` / `ReactElement`)                                 |
| 7    | 3.9ms     | 0.1%  | スクロール/可視矩形の走査(`ScrollView` / `onScroll` / `updateVisibleRect`)       |
| 8    | 0.15ms    | 0.0%  | 我々の `renderRow` / `resolveFileType`                                           |
| —    | 0.0ms     | 0.0%  | 我々の `flatMap` / `map` / `objectsByRowId` の `Map` 構築(検出されず)            |

**4 位と 5 位がページングに強く相関している**(次節)。1 位「未帰属」は V8 が inlining した
フレームや `(program)` の内側で個別関数名を落としているもので、正体は追えていない
(「測れなかったこと」参照)。

### ページング窓 vs 定常窓での内訳の変化

| bucket                                                            | 定常(ページ読込前, 〜1,000 件) | ページング窓(応答後 500ms, 2 回分) | 定常(2 回目読込後 500ms 経過, 〜3,200 件) |
| ----------------------------------------------------------------- | -----------------------------: | ---------------------------------: | ----------------------------------------: |
| react-aria Collection 再構築(`clone`/`addNode`/`useGridListItem`) |                           7.1% |                          **15.8%** |                                     16.3% |
| `Virtualizer`/`GridLayout` 再レイアウト                           |                          14.1% |                              15.3% |                                     15.4% |
| DOM mutation                                                      |                          14.2% |                              15.0% |                                     15.4% |
| V8 native/GC/idle                                                 |                          18.0% |                              15.6% |                                     15.5% |
| React 要素生成                                                    |                           9.0% |                               7.3% |                                      7.1% |
| フレーム数(n)                                                     |                          3,849 |                              2,130 |                                       985 |

**react-aria の Collection 再構築だけが、ページング窓で明確に跳ね上がっている**(7.1% → 15.8%)。
DOM mutation・GC・要素生成はほぼ横ばいで、これらは件数ではなく「スクロールし続けている」こと
自体(Virtualizer の通常のマウント/アンマウント churn)で説明がつく。

「2 回目読込後 500ms 経過」時点でも Collection 再構築が 16.3% と高いままなのは、**件数が増えると
再構築自体の所要時間も伸び、500ms のページング窓では収まりきらずに漏れている**ためだと考えられる
(件数が育つほど O(n) の再構築が長引くという、まさに仮説を支持する形の残差)。

## 境界ごとの時間(定常スクロールフレームの分布)

| 区間                     | 件数目安             | n (フレーム数) |   mean |     p50 |    p95 |        max |
| ------------------------ | -------------------- | -------------: | -----: | ------: | -----: | ---------: |
| 1 回目ページ読込前       | 〜1,000              |          3,849 | 0.40ms | 0.002ms | 2.19ms |     25.8ms |
| 2 回目ページ読込・安定後 | 〜3,000〜3,200       |            985 | 0.43ms | 0.002ms | 2.61ms |     19.2ms |
| （参考）ページング窓のみ | 1,000→3,200 の遷移中 |          2,130 | 0.47ms | 0.002ms | 2.33ms | **89.2ms** |

p50 はほぼ 0(スクロールしていない多くのフレームが軽いため中央値は意味を持たない)。
p95 は 2.19ms → 2.61ms で**約 19% の伸び**にとどまり、3.2 倍の件数増加に対して比例していない。
今回捕捉できた 50ms 超の long task は 3 本のみで、いずれもページング窓の中(前掲の
`max=89.2ms`)に位置していた。**定常スクロール中に 50ms を超えたフレームは 0 本。**

## 総件数に比例しているか

| 対象                                                                     | 比例しているか                                                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react-aria `BaseCollection.clone`/`addNode`/`useGridListItem` の自己時間 | **している。** ページング窓での割合が定常時の 2倍超(7.1%→15.8%)。ソースを読むと `clone()` は `new Map(this.keyMap)` で現在の全キーをコピーする明確な O(n) |
| 定常スクロールフレーム(ページングが起きていない普通のフレーム)の p95     | **していない、あるいは非常に緩やか。** 3.2 倍の件数で p95 は +19% 程度                                                                                    |
| DOM mutation(`removeChild`/`appendChild`)                                | **していない。** ページング窓・定常窓でほぼ同じ割合(14〜15%)                                                                                              |
| V8 native/GC                                                             | **していない。** むしろページング後にやや下がる(18.0%→15.5%)                                                                                              |
| 我々の `flatMap`/`map`/`Map` 構築                                        | 自己時間としては検出されず、判定不能なほど小さい                                                                                                          |

## 仮説への判定

**「react-aria のコレクション構築が支配的」が正しい。** ただし発生源は我々のコードである。
`apps/web/src/routes/-components/object-list/index.tsx:76-79` の

```ts
const rows: readonly Row[] = useMemo(
  () => [...folders.map((folder): Row => ({ kind: 'folder', id: getFolderRowId(folder), folder })), ...objects.map((object): Row => ({ kind: 'object', id: getObjectRowId(object), object }))],
  [folders, objects],
);
```

は `folders`/`objects`(`b.$bucketId.$.tsx:43-44` の `flatMap`)の**配列参照が変わるたびに全件を
作り直す**。個々の `Row` オブジェクトは既存のページの項目も含めて**毎回新しいオブジェクト**になる。

react-aria-components 側(`apps/web/node_modules/.vite/deps/react-aria-components.js`)を読むと:

- `useCachedChildren`(1272 行台)は `WeakMap` を**アイテムのオブジェクト参照**でキャッシュしている。
  `Row` が毎回新規オブジェクトになるため、**このキャッシュは既存項目も含めて全件ミスする**
- `CollectionDocument.queueUpdate`(1632 行台)は dirty なノードがあると
  `this.collection = this.collection.clone()` を呼ぶ。`BaseCollection.clone()`(1266 行台)は
  `collection.keyMap = new Map(this.keyMap)` — **現在の keyMap 全体をコピーする、明確な O(現在の総件数)**
- 続く `updateCollection()` は dirty ノード(= 上記のキャッシュミスにより全件)それぞれに対して
  `addNode()` を呼び直す

つまり: **我々の 3 つの O(n)(`flatMap` ×2, `rows` の `map`, `objectsByRowId` の `Map` 構築)自体は
軽い(自己時間 0.0〜0.1%)。しかし新しい配列・新しいオブジェクトを作ることで `Row` の参照同一性を
壊し、それが react-aria-components 側の差分更新を無効化して、react-aria 自身の内部処理
(`Map` の全コピー + 全ノード再登録)を毎ページ O(n) でやり直させている。** 2 つの仮説は対立しておらず、
**前者が後者を引き起こす一本の因果関係**である。

## 測れなかったこと

- **件数 3,200〜10,000 の区間の詳細な self-time は取れなかった。** CDP trace のバッファが
  約 4.2 秒で頭打ちになり、それ以降のサンプルが記録されなかったため(上述)
- **50ms 超の long task は今回の環境では 3 本しか再現できなかった。** 元の報告にある
  p95 116.4ms 級の劣化(6,359 件時点)は再現できていない。**Playwright の headless Chromium は
  実ブラウザ(特にユーザーの実機)より高速** で、かつ今回はスロットリング(CPU/network throttle)を
  一切かけていない。件数を 3,200 までしか詳細計測できていないこともあり、「件数を増やせば
  仮説 A が支配的になるかどうか」は本計測だけでは判定できない
- **Chrome DevTools MCP の `performance_analyze_insight` は使えなかった。** 別セッションが
  デフォルトの chrome-devtools-mcp プロファイルを握っており、`new_page` の時点でブラウザ起動が
  失敗した(詳細は「計測方法」)。Playwright 直叩きに切り替えたため、Chrome DevTools の
  Insights(自動診断)は利用していない — 自前の解析スクリプトによる手動の bucket 分類のみ
- **React Profiler (`<Profiler onRender>`) による commit 時間の直接計測はやっていない。**
  「production コードを変更したまま終わらない」制約の下で、CPU trace から十分な情報が
  取れたためスキップした。commit ごとの `actualDuration` の系列がほしい場合は追加計測が要る
- **自己時間の 33.7%(「未帰属」)の正体は特定できていない。** V8 が最適化・インライン化した
  フレームは `callFrame` にコードがあっても関数名/URL が失われることがあり、それらは
  `(anonymous)` や名前だけのエントリになる。React のスケジューラ内部処理である可能性が高いが
  確証はない

## 再現に必要なもの(次回計測する人へ)

- `apps/web/.wrangler/state/v3/r2` に perf 用 10,000 件データが既にある。作り直し不要
- `pnpm --filter web dev` → `http://localhost:5173/b/photos/perf/`
- Chrome DevTools MCP が別セッションに握られている場合、Playwright 直叩き
  (`chromium.launch()` + `context.newCDPSession(page)` + `Tracing.start`/`Tracing.end`)で代替できる
- **CPU profiler の hires/stack カテゴリは重い。** 4 秒程度でバッファが埋まるので、長時間
  (10 秒超)スクロールしたい場合はカテゴリを絞るか、`Tracing.start` を複数回に分けて
  短いセグメントごとに取り直す方が安全
- `role="grid"` の `aria-rowcount` 属性は、アプリのコードを一切触らずに**現在の総読み込み件数を
  外部から観測できる**(react-aria-components が自分で書き込んでいる)。ページング速度の
  キャリブレーションに便利

---

## 統合判定(実装読解 + 実測)

本計測と並行して、react-aria v1.20 / react-stately v3.49 の dist を実装レベルで読んだ。
両者を突き合わせた最終判定である。

### 真因: 一本の因果連鎖

```
1. ページ追加のたびに、我々のコードが全件を新しいオブジェクトに包み直す
     b.$bucketId.$.tsx:43-44   data.pages.flatMap(...) ×2 — 配列参照が毎回変わる
     object-list/index.tsx:76  rows の useMemo — 全 Row ラッパを毎回新規作成
          ↓ Row の参照同一性が全件で壊れる
2. react-aria の差分化機構が全件無効化される
     useCachedChildren の WeakMap キャッシュは「item オブジェクトの参照」がキー。
     key や id では判定しない。全件ミス
          ↓
3. react-aria が O(現在の総件数) の再構築を毎ページ実行する
     - n 件の hidden コンポーネント実行(我々の resolveFileType + JSON.stringify も n 回)
     - itemRef クロージャが毎レンダー別 identity → n 回の setProps → n 回の node.clone()
     - BaseCollection.clone() = new Map(keyMap) ×2(全件コピー)
     - GridLayout.update() が全件ループし Rect + LayoutInfo を 2n 個新規アロケート
          ↓
4. ページ追加のスパイクが総件数に比例して伸びる + O(n) のゴミが GC 圧になる
```

### 「単調な fps 低下」の正体

元の実測(2026-08-17)は「3 秒窓あたりのフレーム数」が 265 → 160 へ単調に落ちると報告した。
これは「毎フレームが重くなる」ようにも読めるが、**実測の結果、定常フレームは
ほぼ伸びていない**(p95 +19% / 3.2 倍の件数)。

矛盾ではない。**3 秒窓のフレーム数は、窓内に入るページ追加スパイクを含んで数えている。**
1 窓に 2〜4 回入るページ追加のコストが O(総件数) で伸びるので、
窓あたりのフレーム数は総件数に対して単調に減る。**単調低下はスパイクの成長で説明でき、
毎フレームの劣化を仮定する必要はない。**「ページを 10 倍にしても max が変わらない」
(249ms → 216ms)も、max = 最終盤の追加スパイク ≒ O(10,000) で一致する。

### 実装読解で判明したが、実測でシロ寄りだったもの

| 候補                                                                                  | 実装                                                       | 実測                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GridLayout.getVisibleLayoutInfos` が毎フレーム全 LayoutInfo を線形走査(二分探索なし) | 事実。スクロールイベントも間引きなしで `flushSync` 同期    | **自己時間 0.1%**(〜3,200 件)。6,000〜10,000 件域は未計測だが、Map 全走査 1 万件は 1ms 未満のオーダーで、支配要因になる可能性は低い |
| 選択状態 / dragAndDrop / LoadMoreItem                                                 | いずれも総件数に比例するコスト無し                         | 検出されず                                                                                                                          |
| アイテム実測による強制リフロー                                                        | `preserveAspectRatio: true` により**既に無効化されていた** | 検出されず                                                                                                                          |

### 副次的な発見(修正リスト行き)

- `object-list/index.tsx:111` — `useDragAndDrop({ acceptedDragTypes: 'all', onRootDrop })` の
  **options がインラインオブジェクトなので毎レンダー参照が変わり、内部の useMemo が完全に無効化**
  されている。O(n) ではないが GridList の再レンダーを毎回強制する

### 対処の方向(未実施 — 調査のみ)

**第 1 手: Row ラッパの参照をページ間で安定させる。**既存ページの Row を key で
キャッシュして使い回せば、WeakMap が既存件でヒットし、連鎖の 2〜3 が
O(追加ページ分) に落ちる。残る O(n) は `new Map(keyMap)` ×2(1 万件で 1ms 未満)と
`GridLayout.update` の全件ループ(数 ms)のみで、スパイクは 2 桁縮む見込み。
**ライブラリの変更もフレームワークの乗り換えも不要。アプリ側の数十行で閉じる。**

検証方法: 修正の前後で Task 16 の Layer B(実 Chrome、3 秒窓ごとの rAF delta)を
同一条件で取り直す。見るべき数字は「窓あたりのフレーム数の単調低下が消えるか」と
「ページ追加スパイクの max」。

第 2 手(第 1 手で不足の場合のみ): `GridLayout` を継承し `getVisibleLayoutInfos` を
固定サイズ前提の算術(`floor(y / rowHeight)`)に override する。`Layout` は public class で
`layout` prop にインスタンスを渡せることは確認済み。**ただし実測 0.1% なので、
先回りで入れる価値は現時点では無い。**
