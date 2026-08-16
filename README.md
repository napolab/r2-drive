# r2-drive

English | [日本語](./README.ja.md)

A self-hosted file browser that makes a Cloudflare R2 bucket feel like Google Drive. A single
Worker serves both the UI and the API, and authentication is delegated entirely to Cloudflare
Access — the app carries no auth implementation of its own.

> **This is Phase 0.** Browsing, uploading, downloading and deleting work today.
> The viewers (Markdown editor, image viewer, video/audio player) are not built yet.

## What works

|                                                                               | Status      |
| ----------------------------------------------------------------------------- | ----------- |
| Browsing the folder hierarchy (R2 common prefixes are treated as folders)     | ✅          |
| Virtualized listing for large folders (react-aria `Virtualizer` + `GridList`) | ✅          |
| Multi-select, range select, cmd+A, context menu                               | ✅          |
| Upload (single PUT, multipart above 100 MiB, drag & drop and file picker)     | ✅          |
| Download / copy path / delete                                                 | ✅          |
| Range-aware delivery (seeking in video and audio)                             | ✅          |
| Image thumbnails                                                              | ✅          |
| Markdown editor, image viewer, media player                                   | ⬜ Phase 2+ |
| Collaborative editing (Yjs on Durable Objects)                                | ⬜ Phase 3  |

## Architecture

```
                    ┌──────────────────────────────┐
   Cloudflare       │  Worker (apps/web)           │
   Access  ───────► │                              │
   (auth at edge)   │   Hono ─┬─ /api ─► packages/api ─► R2 binding
                    │         │                    │
                    │         └─ /*   ─► TanStack Start (React 19)
                    └──────────────────────────────┘
```

- **Monorepo** — pnpm workspaces (`apps/*` + `packages/*`)
- **UI** — TanStack Start + React 19 + react-aria-components + Panda CSS (no RSC)
- **API** — Hono, typed end to end into the UI via Hono RPC (`hc`)
- **Errors** — neverthrow `Result` plus `Error` subclasses chained through `cause`
- **Auth** — Cloudflare Access (`@hono/cloudflare-access`); no auth code in the app

`packages/api` does not depend on `apps/web`. That independence is what makes splitting the
Worker possible later, and it is enforced by oxlint's `no-restricted-imports` rather than by
convention.

### Extension points

Adding a feature means writing one plugin and adding one line to a registry. No branch is added
to the core.

- **`FileTypePlugin`** — file kind detection, icon, and preview (`apps/web/src/plugins/file-type/`)
- **`ObjectAction`** — operations in the listing and context menu (`apps/web/src/plugins/object-action/`)

Both are resolved by `createRunner` from `packages/core`. Registries are explicit arrays because
**order is meaningful** (specific → broad, with the fallback always last), which is why
`import.meta.glob` auto-collection is deliberately not used.

## Setup

```bash
pnpm install

# Environment-specific values are not committed; create them from the examples
cp apps/web/wrangler.jsonc.example apps/web/wrangler.jsonc
cp apps/web/.dev.vars.example apps/web/.dev.vars

pnpm --filter web dev   # http://localhost:5173
```

Values to fill in `apps/web/wrangler.jsonc`:

| Key                        | Meaning                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `vars.ACCESS_TEAM`         | Your Zero Trust team name (the `<team>` in `<team>.cloudflareaccess.com`) |
| `vars.ACCESS_AUD`          | The application AUD tag from the Zero Trust dashboard                     |
| `r2_buckets[].bucket_name` | Your R2 bucket names. Leave `binding` alone — it is referenced from code  |

For local development, `IDENTITY_PROVIDER=static` in `.dev.vars` skips Access verification.
Without it every request returns 401, because there is no Access in front of the Worker locally.
That default is intentional: the config fails closed, so forgetting to configure it disables the
app rather than disabling authentication.

R2 runs on miniflare's local storage, so no real bucket is needed for development.

## Deploy

```bash
pnpm --filter web deploy
```

`workers_dev` is set to `false`. **Do not set it to `true`.** Access sits in front of the Worker,
so anyone hitting the `workers.dev` domain directly would bypass authentication entirely.

## Tests

```bash
pnpm test                    # everything (vitest)
pnpm test:browser:install    # first run only: fetch the managed Chromium
pnpm test:browser            # geometry assertions in a real Chrome
pnpm lint
pnpm typecheck
```

Tests in `packages/api` run on workerd through `@cloudflare/vitest-pool-workers`, against a
**real R2 binding** — not a mock.

## Conventions

Documented in `CLAUDE.md` and `.claude/rules/`. Three rules carry most of the weight:

- **Open/Closed comes first.** An extension point is only justified when two implementations
  already exist at the time it is introduced
- **No optional fields.** "B exists only when A does" is two variants, not two `?:`
- **Colors, spacing and sizes go through tokens** (Panda's `strictTokens`). Color contrast is
  asserted against WCAG 2.1 AA in unit tests, so violating it fails CI

## Prior art

[G4brym/R2-Explorer](https://github.com/G4brym/R2-Explorer) (MIT) informed the API design. Its UI
is Vue + Quasar, so none of it was reused.

## License

[MIT](./LICENSE)
