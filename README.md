# r2-drive

Cloudflare R2 を Google Drive のように扱う、self-hosted なファイルブラウザ。単一の Worker で
UI と API の両方を提供し、認証は Cloudflare Access に寄せてアプリ側に持たない。

> **Phase 0 の段階です。** 一覧・アップロード・ダウンロード・削除まで動きます。
> ビューア(Markdown エディタ / 画像ビューア / 動画・音声プレイヤー)は未実装です。

## できること

|                                                                     | 状態            |
| ------------------------------------------------------------------- | --------------- |
| フォルダ階層のブラウズ(R2 の共通接頭辞を folder として扱う)         | ✅              |
| 大規模フォルダの仮想化一覧(react-aria `Virtualizer` + `GridList`)   | ✅              |
| 複数選択・範囲選択・cmd+A・context menu                             | ✅              |
| アップロード(単発 PUT / 100 MiB 超は multipart、D&D とファイル選択) | ✅              |
| ダウンロード / パスのコピー / 削除                                  | ✅              |
| Range 対応の配信(動画・音声のシーク)                                | ✅              |
| 画像のサムネイル表示                                                | ✅              |
| Markdown エディタ・画像ビューア・メディアプレイヤー                 | ⬜ Phase 2 以降 |
| 共同編集(Yjs on Durable Objects)                                    | ⬜ Phase 3      |

## アーキテクチャ

```
                    ┌──────────────────────────────┐
   Cloudflare       │  Worker (apps/web)           │
   Access  ───────► │                              │
   (前段で認証)      │   Hono ─┬─ /api ─► packages/api ─► R2 binding
                    │         │                    │
                    │         └─ /*   ─► TanStack Start (React 19)
                    └──────────────────────────────┘
```

- **モノレポ** — pnpm workspaces (`apps/*` + `packages/*`)
- **UI** — TanStack Start + React 19 + react-aria-components + Panda CSS(RSC は使わない)
- **API** — Hono。`hc` による Hono RPC で UI まで型が通る
- **エラー** — neverthrow の `Result` と `Error` サブクラスの `cause` 連鎖
- **認証** — Cloudflare Access(`@hono/cloudflare-access`)。アプリ側に認証実装を持たない

`packages/api` は `apps/web` に依存しない。これが将来 Worker を分割できる余地の実体で、
oxlint の `no-restricted-imports` で強制している。

### 拡張点

機能追加は「プラグインを 1 つ書いて registry に 1 行足す」で完結し、コア側の分岐が増えない。

- **`FileTypePlugin`** — ファイル種別の判定・アイコン・プレビュー(`apps/web/src/plugins/file-type/`)
- **`ObjectAction`** — 一覧と context menu の操作(`apps/web/src/plugins/object-action/`)

どちらも `packages/core` の `createRunner` で解決する。registry は明示配列で、
**順序に意味がある**(specific → broad、フォールバックは必ず最後)。

## セットアップ

```bash
pnpm install

# 環境固有の値はリポジトリに入っていないので、example から作る
cp apps/web/wrangler.jsonc.example apps/web/wrangler.jsonc
cp apps/web/.dev.vars.example apps/web/.dev.vars

pnpm --filter web dev   # http://localhost:5173
```

`apps/web/wrangler.jsonc` に埋める値:

| キー                       | 意味                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `vars.ACCESS_TEAM`         | Zero Trust のチーム名(`<team>.cloudflareaccess.com` の `<team>`) |
| `vars.ACCESS_AUD`          | Zero Trust ダッシュボードのアプリケーション AUD タグ             |
| `r2_buckets[].bucket_name` | 自分の R2 バケット名。`binding` はコード側と対応するので変えない |

ローカル開発では `.dev.vars` の `IDENTITY_PROVIDER=static` が効いて Access の検証を飛ばす。
前段に Access が居ないローカルでこれを忘れると全リクエストが 401 になる
(既定を `access` にした fail-closed な設計なので、それが想定どおりの挙動)。

R2 は miniflare のローカルストレージに載るので、開発に実バケットは要らない。

## デプロイ

```bash
pnpm --filter web deploy
```

`workers_dev` は `false` にしてある。**`true` にしてはいけない。** Access は Worker の前段に
いるだけなので、`workers.dev` のドメインを直接叩かれると認証を素通りする。

## テスト

```bash
pnpm test                    # 全体(vitest)
pnpm test:browser:install    # 初回だけ: 管理下の Chromium を入れる
pnpm test:browser            # 実 Chrome での geometry 検証
pnpm lint
pnpm typecheck
```

`packages/api` のテストは `@cloudflare/vitest-pool-workers` で workerd 上の
**本物の R2 binding** 相手に走る。モックではない。

## 開発の規約

`CLAUDE.md` と `.claude/rules/` にまとまっている。特に設計の背骨は 3 つ。

- **Open/Closed を最優先する。** 拡張点を作ってよいのは、導入時点で実装が 2 つ以上あるときだけ
- **optional field を作らない。** 「A があるときだけ B がある」は 2 つの `?:` ではなく 2 つの variant
- **色・余白・サイズは token を通す**(Panda の `strictTokens`)。色のコントラストは
  WCAG 2.1 AA を単体テストで強制していて、割ると CI が落ちる

## 先行事例

[G4brym/R2-Explorer](https://github.com/G4brym/R2-Explorer)(MIT)を API 設計の参考にした。
UI は Vue + Quasar なので流用していない。

## License

[MIT](./LICENSE)
