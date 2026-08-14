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
