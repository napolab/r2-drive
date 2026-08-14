# Design Direction

`www.napochaan.com` の UI 哲学をこのリポジトリに導入したもの。何を持ち込み、何を意図的に持ち込まなかったかまで含めて、ここが唯一の出典である。

出所は同リポジトリの colophon(`src/app/(site)/colophon/content.ts`)に書かれた「所見」5 つと、`src/themes/` のトークン体系。

## 中核の原則 — 枠が固いほど、崩せる

> 崩すために作ったサイトなのに、足元は選べる中でいちばん厳密な枠でできてる。色も余白も Panda CSS の strictTokens を通さないと触れないし、インタラクションの足場は react-aria-components。矛盾して見えるかもだけど、**枠が固いほど、その上で安心して崩せる。**
>
> ひとつだけ崩すことより優先したのがアクセシビリティ。color token は WCAG 2.1 AA を満たすように設計してあるから、**どのページでどれだけ盛ってもコントラストは自動的に守られる。**

これは表現論ではなく運用規約である。r2-drive では次の 3 点として実装する。

1. **`strictTokens: true`。** 色・余白・サイズは token を通さないと書けない。任意値はビルドエラーになる
2. **react-aria-components を足場にする。** `ui-ux.md` の実現順序(HTML+CSS → react-aria → 変更提案 → 独自実装)を守る
3. **コントラストを単体テストで強制する。** token の値そのものを `contrastRatio()` で検証し、AA を割ったら CI が落ちる。「気をつける」ではなく「割れない」

**3 が肝である。** アクセシビリティを守るのに実装者の注意力を当てにしない。token 設計の時点で AA を保証しておけば、その上で何を作っても自動的に守られる。

## この製品での中核 — 全部に、名前がついてしまう

> 機械が等幅で淡々と吐くシステム注釈——タイムスタンプ、座標、since 2020、gen / alive のカウンタ。

元のサイトではこれは**演出**だった。r2-drive では**本来の情報**である。

ファイルサイズ、更新日時、オブジェクト数、キーのパス、ETag、アップロードの進捗、Range のバイト位置 — Drive UI が扱う情報はほぼすべてがシステム注釈そのものだ。だから:

- **数値と識別子は等幅で組む。** サイズ・日時・件数・パス・ETag は `fonts.mono`
- **数値は `fontVariantNumeric: 'tabular-nums'`。** 行が変わっても桁が揃う
- 装飾として足すのではなく、**情報として正確に出す**

## トークン体系

`apps/web/src/themes/` に置く。値の根拠は元リポジトリと同じ。

| | 内容 | 理由 |
|---|---|---|
| 色空間 | oklch | 知覚的に均等な明度。ramp を機械的に作れる |
| ramp | **gray(hue 265)/ blue(266)/ red(25)の 3 本のみ** | pink / violet / cyan を持たないことをテストで禁止する。増やすなら設計判断として明示的にやる |
| 角丸 | **既定 `none: 0`。`pill` のみ例外** | シャープが既定。丸めたいときは意図を持って `pill` を選ぶ |
| 罫線 | hairline 1px / default 2px / strong 3px | 3 段しかない。中間値を作らない |
| グリッド | **24px モジュール**(`sizes.gridCell`) | 余白の `block` も 24px。行高もこの倍数に寄せる |
| 行送り | none 0.9 / tight 1.2 / snug 1.4 / body 1.7 / **jp 1.9** | **和文は別扱い。**日本語の本文に 1.7 は詰まりすぎる |
| タップ標的 | `targetMin: 24px` / `targetComfortable: 44px` | WCAG 2.1 の 24px 最小と、実用的な 44px |

セマンティックトークンは light-first で `bg` / `fg` / `border` / `grid` / `accent` / `danger` の 6 グループ。

### 罫線には 2 種類ある

装飾的な区切り(行の仕切り、カードの輪郭、グリッド線)は `border.subtle` / `default` / `strong` を使う。WCAG 1.4.11(非テキストコントラスト 3:1)の対象外なので、明度を自由に選べる。

一方、**境界線だけがコンポーネントの存在を示す**場合(入力欄、チェックボックス、選択可能なタイル、フォーカスリング)は `border.interactive` / `border.focus` / `accent.solid` を使う。これらは `bg.canvas` に対して 3:1 以上を単体テストで強制している(`tokens/tokens.test.ts`)。

迷ったら `border.interactive`。装飾用途に使っても違反にはならない — 逆に `border.default` を境界線の識別だけに頼るコンポーネントに使うと、AA を割ったまま気付けない。

アクセント色の境界が要る場合は `border.focus` か `accent.solid` を使う。どちらも 3:1 を単体テストで守っている。**この 2 分類のどちらにも属さない色トークンを境界線に使わないこと** — テストが守れない領域になる(`accent.border` を廃止したのはこのため。blue.7 = 2.48:1 で 1.4.11 を割るうえ、装飾にも機能にも分類されていなかった)。

## フォント

**`M PLUS 1`(Google Fonts)+ システムスタックのみ。**

元リポジトリの `digibop`(display)と `config-mono-vf`(mono)は Adobe Fonts(Typekit)のドメイン単位ライセンスであり、Access 配下の非公開ツールに引き込む価値より手間が勝ると判断した。

- **body:** `M PLUS 1`(和文の可読性を担保)→ system-ui
- **display:** システムサンセリフ。Drive UI に巨大な見出しはほぼ無い
- **mono:** `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`。**この製品で最も使用量が多い書体**

元リポジトリの `M PLUS 1` は「Latin だけ 700 の別インスタンスを前置し、和文はシステムフォントの太さを保つ」という仕込みをしている。**この手法は持ち込む**(`fonts.ts` のコメントに理由がある)。

## モーション

**フォーカスリングだけを持ち込む。**

- `motion-safe`: マーチングアンツ(`marchingAnts` keyframes + `focusRing` layerStyle)
- `prefers-reduced-motion`: 静的な破線

同時に動くのは常にフォーカスされた 1 要素だけなので、10,000 行の仮想化一覧の上でもコストは実質ゼロである。

### 持ち込まなかったもの

元リポジトリの所見 04「単純な規則が、生命に見える」に属する演出群 — 背景の Game of Life、`ScrambleText`、`EchoText`、`TypewriterText`、`DecodingSkeleton`、マーキー、`SafeAreaTint` の scroll-timeline 追従 — は**持ち込まない。**

理由は 1 つ。**Phase 0 の受け入れ基準 1「10,000 オブジェクトのフォルダをスクロールしてもフレーム落ちしない」と正面から衝突するから。**仮想化された行と同じ画面で常時描画を回すのは、この基準を捨てるということである。

これは「あの表現が悪い」という判断ではない。**道具と作品では守るべきものが違う**、という判断である。

## 参照

- 哲学の原文: `napolab/www.napochaan.com` の `src/app/(site)/colophon/content.ts`(所見 01〜05)
- トークンの原典: 同 `src/themes/tokens/index.ts`、`src/themes/contrast.ts`
- 持ち込まなかった演出の実装: 同 `src/components/{game-of-life,scramble-text,echo-text,decoding-skeleton,marquee,safe-area-tint}`

Phase 3(markdown エディタ)で syntax highlight が要るときは、元リポジトリの `semanticTokens.colors.code.*` がコントラスト比を注記付きで持っている。持ち込むならそこから。
