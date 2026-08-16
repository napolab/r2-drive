## project setup rules

- pnpm workspaces のモノレポで構成すること(`apps/*` + `packages/*`)
- Cloudflare Worker を利用すること
- TanStack Start + Hono を利用すること。**RSC は使わない**(`'use client'` はこのリポジトリに存在しない)
- Hono を使うときは Hono RPC が生きる形で書き、`hc` で type safe な client を提供すること
    - ルートはメソッドチェーンで書く。途中で `const` に代入して分割すると型が積み上がらない
    - ハンドラは `c.json()` を返す。`Response` 直返しは戻り型が消える
    - 入力は `@hono/zod-validator` の `zValidator` を通す
    - ステータスはリテラルで書く(`c.json(body, 404)`)。`res.status` のナローイングが効かなくなる
- react-aria-components, panda css を利用すること
- 認証は Cloudflare Access に寄せ、アプリ側に認証実装を持たないこと
- `pnpm fmt` で `pnpm oxfmt --write`, `pnpm oxlint --fix` を実行すること
- `pnpm lint` で `pnpm oxfmt --check`, `pnpm oxlint` を実行すること
- `@typescript/native-preview` (tsgo) を利用すること
- 実装をする前にライブラリについて知らないことがある時は context7, web で調査してから進めること
- **車輪の再発明をする前に npm を広く調査すること。**自作を選ぶなら「なぜ既製品を使わないか」を spec に書き残すこと
- vitest を利用した TDD で実装すること
    - `packages/api` のテストは `@cloudflare/vitest-pool-workers` で本物の R2 binding 相手に走らせること
- husky で commit 時に lint, typecheck を実行すること
- 勝手に commit しないこと
- 実装は小さいタスクに分けて実装すること。実装が終わったら difit を起動して私に review 依頼すること
- review で繰り返し受けた内容は rules, skills にすることで永続化して
    - review の内容はまず memory に記憶して繰り返し指摘されるものは skills にすること

## architecture rules

設計の全体は `docs/superpowers/specs/2026-08-14-r2-drive-design.md` を読むこと。以下はその中でも破ってはいけないもの。

- **Open/Closed 原則を最優先すること。**機能追加は「プラグインを1つ書いて registry に1行足す」で完結し、コア側の分岐が増えないこと
    - 拡張点を作ってよいのは、**導入時点で実装が2つ以上あるか、名前のついたフェーズで2つ目が確定しているとき**だけ
    - ディスパッチは `packages/core/src/create-runner.ts` を共有すること。新しいディスパッチ形(`Map<k, fn>`, `switch`, スコア方式)を発明しないこと
    - registry は明示配列にすること。**順序に意味がある**(specific → broad)ので `import.meta.glob` の自動収集は使わないこと
- **`packages/api` は `apps/web` に依存しないこと。**これが将来の Worker 分割可能性の実体であり、oxlint の `no-restricted-imports` で強制している
    - `@r2-drive/api`(Hono アプリの値)を import してよいのは `apps/web/src/worker.ts` だけ
    - それ以外は `@r2-drive/api/client`(型 + client ファクトリ)だけを触ること
- **Worker が自分の公開ホスト名を `fetch()` しないこと。**ループバックせずエッジに出て Access に弾かれる。SSR では `hc` の `fetch` に `api.fetch(req, env, ctx)` を差すこと
- `packages/*` は React も Workers グローバルも import しないこと(`packages/api` の Workers API は例外)
- `packages/*` は npm 公開しないので `exports` を `./src/index.ts` に向け、パッケージごとのビルド手順を持たないこと
- Hono / React / neverthrow などの共有依存は `pnpm-workspace.yaml` の catalog で一元管理すること
    - Hono はバックエンドとフロントエンドでバージョンがずれると RPC の型が壊れる

## coding rules

- あなたは実装計画、ステークホルダーである私に対して要件のブレがなくなるまで AskUserQuestion で質問することに努め、実装は subagent に任せること
- 関数は単一責任で実装すること
- 同時に命令が複数来た時は Task で優先順位をつけて subagent に実装を任せること
- **optional field を作らないこと。**「A があるときだけ B がある」は 2 つの `?:` ではなく 2 つの variant
- **エラーはクラスにして `cause` で連鎖させること。**消費エッジでは `findCause` で再帰的にチェーンを掘って判別する
- `.match` は消費エッジ 1 箇所だけ。service / domain 層は `ResultAsync` を返し続けること

## ui rules

- WCAG2.1 AA 基準を満たすように color token を設計すること
- UI は文脈に沿った内容にすること
    - 機械的なUIの利用は徹底的に避けること
    - 伝えたい情報はどんなものでその情報に適切な UI を常に考察、模索すること
    - ASCII ダイアグラムで提案すること
    - AskUserQuestion であなたが考えたパターンを私に提示してどれがいいか提案すること
- UI を作る時は以下の順番で実現を目指すこと。1が難しいなら2を2が難しいなら3をやる, 3 が難しいなら 4 をやる
  1. HTML + CSS で実装
  2. `react-aria-components` で実装
  3. 独自実装を行う前に UI の変更の提案をする
  4. 独自実装で UI を実装する
- リンクを使いたい時は `react-aria-components` の Link を利用すること
    - `react-aria-components` の RouterProvider が利用されていることが前提
- 大きなコレクションは react-aria の `Virtualizer` で仮想化すること
    - 選択状態は DOM ではなくコレクションが持つ。`@tanstack/react-virtual` を素で被せると範囲選択と cmd+A が壊れる

## ref repository

ここに書かれているリポジトリには gh コマンドで参照し、既存実装を参照する前に ref repository の内容を先に探すこと
issue, .claude/rules, skills やコードが参考になる。

- https://github.com/napolab/www.napochaan.com — rules / skills の出所。skyline packing の実装(`src/components/gallery-archive/skyline/`)
- https://github.com/napolab/y-durableobjects — Yjs on Durable Objects(Phase 3 の共同編集)
- https://github.com/napolab/durabcast — Cloudflare Durable Object を利用する際に使用できるライブラリ
- https://github.com/G4brym/R2-Explorer — 先行事例(MIT)。`packages/worker` が API 設計の参考になる。UI は Vue + Quasar なので流用しない

<--- ここから --->
<--- ここまで --->

## comment rules
- `<--- ここから --->` `<--- ここまで --->` と書かれている場合はその範囲は commit しないこと

## resources rules
- mockup 用の画像が必要な時は Codex CLI の組み込み画像生成スキル `$imagegen` を使うこと
- 使い方:
    - headless（推奨）: `codex exec "<生成したい画像の説明> $imagegen"`
    - 対話: `codex "<説明> $imagegen"`
    - 参照画像を渡す: `codex -i ref.png "<説明> $imagegen"` / `codex --image a.png,b.jpg "<説明>"`
- モデルは `gpt-image-2`。生成画像は `~/.codex/generated_images/`（`$CODEX_HOME/generated_images/`）に保存される
- 出力先パス・サイズ・品質・透過・枚数は プロンプト内に自然言語で指定する（`--out`/`--size` 等のフラグは不要）
- 用途: アイコン・バナー・イラスト・スプライト・プレースホルダ等のモックアップ素材


<claude-mem-context>
# Memory Context

# [r2-drive] recent context, 2026-08-16 3:13am GMT+9

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,320t read) | 383,857t work | 95% savings

### Aug 14, 2026
60318 11:58p 🔄 Content-Range arithmetic extracted to pure function `resolveContentRange` in `range.ts`
60319 " 🔵 `R2Range` non-suffix variants share `offset` key — `'offset' in object.range` cannot narrow type
60321 " ✅ Task 8 fix committed as c16da24 on feat/phase-0
### Aug 15, 2026
60322 12:00a ✅ Task 8 re-review agent launched for fix round 1 verification
60324 12:01a ✅ Task 8 marked complete — re-review confirmed all findings addressed, no new breakage
60329 12:02a 🟣 Task 9 implementation agent dispatched — idempotent object deletion endpoint
60333 12:03a 🟣 Task 9 DELETE endpoint implemented — deleteObject function and integration tests created
60334 " 🟣 Task 9 DELETE route appended to Hono chain in buckets/index.ts
60338 12:05a 🟣 Task 9 complete: DELETE route wired into Hono chain — buckets/index.ts now has 4 routes
60339 12:06a 🔴 Task 9 COMPLETE — commit 55cfa22, all checks green, Task 10 brief generated
60365 12:12a 🟣 Task 10 RED confirmed — 4/4 tests fail with routes-undefined error patterns
60367 " 🔴 Task 10 GREEN — 4/4 tests pass including 5MiB multipart upload in workerd (59ms)
60373 12:14a 🟣 Task 10 report written — key claim: Number.isInteger is predicate not coercion, out of scope for primitive-coercion rule
S6652 Memory observer session tracking r2-drive Phase 0 SDD build — Task 10 review complete, Task 11 implementer dispatched (Aug 15 at 12:15 AM)
S6658 Memory observer session tracking r2-drive Phase 0 SDD — Task 11 complete, reviewer agent running (Aug 15 at 12:21 AM)
60411 12:37a 🔴 Task 11 complete — commit 42cfd9a. Final request() signature: F extends type captures function, InferResponseType&lt;F,200&gt; derives success body. Both tsgo and tsc exit=0.
S6662 Memory observer session — Task 11 fix loop in progress: 3 Important findings being fixed (Aug 15 at 12:40 AM)
S6663 Task 11 fix loop complete — re-review agent launched for Important 1/2/3 verification; design-direction.md committed (Aug 15 at 12:53 AM)
S6665 Memory observer session tracking r2-drive primary session: Task 11.5 (design tokens + WCAG AA enforcement) implementer agent launched and actively reading source files (Aug 15 at 1:00 AM)
S6670 R2-backed Google Drive-style UI: Phase 0 design token foundation (Task 11.5) — implement Panda CSS token system, WCAG contrast enforcement, self-hosted fonts, and fix discovered issues (Aug 15 at 1:07 AM)
60427 1:10a ⚖️ R2-backed Google Drive-style UI: Tech Stack Selection Discussion
60428 1:14a 🟣 Panda CSS Design Token System Created for r2-drive
60429 " 🟣 OKLCH Contrast Ratio Utility and WCAG Token Tests Added
60430 " 🔵 Gray Scale Contrast Audit: border.default Requires gray-9 to Pass WCAG 1.4.11
60431 " 🔵 @fontsource/m-plus-1 Confirmed Installed with Latin woff2 at Weights 400, 500, 700
60432 1:15a 🔵 Panda CSS globalFontface API Confirmed for Self-Hosted Font Registration
60433 " 🟣 Self-Hosted M PLUS 1 Font Configuration Module Created
60434 " 🔄 fonts.ts Switched to defineGlobalFontface() Wrapper
60435 " 🟣 Minimal Global CSS Module Created for r2-drive
60436 1:16a 🟣 panda.config.ts Fully Wired with Design System; CSS Vars Injected on HTML Root
60437 " 🔵 panda codegen Fails: esbuild Has No .woff2 Loader (Unlike Vite)
60438 1:18a 🔴 Font Setup Moved Out of Panda globalFontface to Raw CSS String Injected via Vite
60439 " 🔴 panda codegen Now Succeeds After Removing woff2 Imports from Config Pipeline
60440 " 🔵 Monorepo Uses tsgo (Go-based TypeScript Compiler) for Type Checking
60441 " 🔵 Vitest Confirms border.default WCAG Failure; 88/89 Other Tests Pass
60442 " 🔵 Panda CSS Default Font Size Tokens Included in Output Alongside Custom Tokens
60443 1:19a 🔴 Index Page Style Updated to Use Custom Token Scale (xl/semibold vs Default 2xl/bold)
60444 " 🔵 r2-drive Toolchain Uses oxfmt + oxlint for Linting (Rust-based, Zero Errors)
60445 " 🔵 panda codegen Runs Automatically via pnpm prepare Hook on Install
60446 1:20a 🔴 fg.muted Changed from gray-11 to gray-7 — Introduces New WCAG AA Text Failure
60447 " ✅ Git Status: Design System Changes Ready to Commit
60448 1:22a ✅ Task 11.5 Report Filed: Design Token Foundation BLOCKED on border.default WCAG Failure
60449 1:23a 🔵 Full Gray Scale Contrast Audit: All Border/Grid Semantic Tokens Fail WCAG 1.4.11
60450 " 🔵 Additional WCAG Failures: border.focus (blue.7=2.48) and danger.border (red.7=2.33) Also Fail 3.0
60451 1:24a ⚖️ Ruling 18 & 19: Split Border Tokens into Decorative/Interactive; Remove Panda Default Preset
S6672 Task 11.5 UI基盤(デザイントークン・コントラスト強制)のコミットとレビュー開始 (Aug 15 at 1:25 AM)
60452 1:25a 🔴 Ruling 18 Applied: border.interactive Added, border.focus Fixed, danger.border Corrected, WCAG Tests Restructured
60453 1:26a 🟣 design-direction.md Updated with Decorative vs. Interactive Border Usage Rules
60454 " 🔴 All Token Tests Now Pass: 26/26 Green After Ruling 18 Changes
60455 " 🔵 Negative Control Confirmed: border.interactive Test Correctly Detects Gray.8 Failure; Ruling 19 Preset Research
60456 " ✅ Ruling 19 Applied: presets Restricted to @pandacss/preset-base in panda.config.ts
60457 1:27a 🔴 Ruling 19 Succeeded: preset-base Only Removes Default Tokens; No Breakage
60458 " 🟣 All CI Checks Green: 92/92 Tests Pass, Typecheck and Lint Exit 0
60459 " 🔵 @pandacss/preset-base Used in Config But Not Declared as Explicit Dependency
60460 " 🔴 @pandacss/preset-base Added as Explicit devDependency to apps/web
S6684 続けて — Ruling 20 (accent.border削除) 完了確認・Task 11.5完了・Task 12着手 (Aug 15 at 1:31 AM)
S6685 Task 12 実装完了・レビュー dispatch — FileTypePlugin / ObjectAction registry の初 UI コード (Aug 15 at 4:52 AM)
60604 5:07a ⚖️ R2-backed Google Drive-like UI: Tech Stack Decision
S6687 Task 12 review fixes complete; Task 13 (virtualized object list - Phase 0 centerpiece) dispatched and implementing (Aug 15 at 5:19 AM)
60605 5:55a ⚖️ R2-Backed Drive UI Project Initiated with React Stack

Access 384k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>