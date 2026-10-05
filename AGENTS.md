# bunbolt — Agent Notes

A forum framework: Bun + Hono backend, Vue 3 + Vite frontend, Reka UI components,
and one codebase that runs on SQLite, PostgreSQL or MySQL.

## Commands

- Install: `bun install`
- Dev (API + Vite together): `bun run dev` → UI on :5173, API on :3000, `/api` proxied
- API only: `bun run start` → :3000, serves `dist/` too if it has been built
- Build frontend: `bun run build` → `dist/`
- Migrate uploads to S3: `bun run migrate:s3`
- Typecheck: `bun run typecheck` (`tsc --noEmit`)
- Tests: `bun test`

## Stack

- Runtime: Bun 1.4.2+ (`bun:sqlite`, `Bun.password`, `Bun.serve`)
- Backend: Hono 4 — routes in `src/server/routes.ts`, session in `src/server/auth.ts`
- DB: Drizzle ORM 0.45 — drivers `drizzle-orm/bun-sqlite`, `node-postgres`, `mysql2`
- Frontend: Vue 3.5 `<script setup>`, vue-router 5, Vite 8
- UI: Reka UI 2 (headless — all styling is in `src/web/style.css`)
- Markdown: markdown-it 15, configured safe-by-construction (see below)
- Storage: local disk or any S3-compatible bucket, via `aws4fetch` (SigV4 over
  `fetch` — no AWS SDK)

## Layout

```
index.ts                 server entry: ensureSchema() then Bun.serve
src/shared/types.ts      row contract, imported by BOTH db and web (dependency-free)
src/db/ddl.ts            hand-written bootstrap DDL, one list per dialect
src/db/schema/{sqlite,pg,mysql}.ts   Drizzle table defs, one file per dialect
src/db/index.ts          picks a driver from DATABASE_URL, exports db/tables
src/db/repo.ts           every query, written once for all three engines
src/server/app.ts        Hono app: /api first, /uploads, static SPA last
src/server/routes.ts     the whole API surface
src/server/storage.ts    local/S3 object storage, one `put`/`publicUrl` pair
src/server/filetype.ts   magic-byte sniffing — the upload security boundary
src/web/                 Vue app; `pages/` are routes, `components/` are pieces
src/web/markdown.ts      the markdown renderer — a security boundary, see below
scripts/migrate-to-s3.ts one-shot local → bucket copy
test/                    bun:test checks: db, post tree, markdown, uploads, s3
bunfig.toml              test preload; keeps tests off the real db/upload dir
```

## Non-obvious rules

**Drizzle has no cross-dialect table builder.** `sqliteTable`, `pgTable` and
`mysqlTable` are mutually incompatible, so there are three schema files and
`db`/`tables` are deliberately typed `any` (see the header of `src/db/index.ts`).
Type safety comes from `src/shared/types.ts` instead. When you add a column, you
must touch **all four** places: `shared/types.ts`, the three `schema/*.ts`, and
`ddl.ts`.

**The schema is bootstrapped, not migrated.** `ensureSchema()` runs the
idempotent DDL in `ddl.ts` on every boot — there is no `db:push` step to forget.
Table statements are strict (a failure aborts startup); index statements are
tolerant because MySQL has no `CREATE INDEX IF NOT EXISTS`.

**MySQL needs care that the other two don't.**
- A `TEXT` column cannot be `UNIQUE`/`INDEX`ed without a key length → short
  indexed strings are `VARCHAR(191)`.
- A `TEXT` column cannot have a `DEFAULT` → the app passes every value on insert.
- There is no `INSERT ... RETURNING` → `insertReturningId()` in `repo.ts` uses
  `$returningId()` for MySQL and `.returning()` elsewhere.

**PostgreSQL returns `count()` as a string bigint.** Always go through
`groupCounts`/`countWhere` in `repo.ts`, which `Number()`s the result.

**Hono's signed-cookie helpers take arguments in different orders:**
`getSignedCookie(c, secret, name)` but `setSignedCookie(c, name, value, secret, opts)`.

**Drizzle selects every column, so a cast can hide a leak.** `findUserById` and
`findUserByUsername` return rows that genuinely contain `password_hash` at
runtime; the `UserAuthRow` type is honest about that. The session middleware
stores a `PublicUser` projection in `c.var.user` so no route can serialize a
hash. If you add a user query, strip it with `toPublicUser` before responding.

**`src/web/markdown.ts` is a security boundary, not a formatting helper.** Post
bodies are stored as raw Markdown and reach the DOM through `v-html`, so the
renderer must be structurally unable to emit attacker HTML. It is safe because
`html: false` escapes raw HTML (every emitted tag is one markdown-it generated)
and markdown-it's default `validateLink` drops `javascript:` / `vbscript:` /
non-image `data:` URLs. **Do not enable `html: true` or override `validateLink`**
without adding a sanitizer. `test/markdown.test.ts` asserts structural
properties (no executable tag) rather than output substrings — an escaped
payload legitimately appears in the output as text, so substring checks there
are meaningless and will lie to you.

**A `<script setup>` component exposes nothing by default.** `MarkdownEditor`
calls `defineExpose({ focus })` so parents can focus it; a template `ref` on such
a component is an empty object without that call.

**Uploads keep one public URL across backends — that invariant is load-bearing.**
An object is always `/uploads/<key>`, never a bucket URL, and Hono always answers
that path (`app.ts`): local streams the bytes, S3 issues a 302. This is the only
reason `migrate:s3` can be a plain file copy — post bodies and `avatarUrl`
already contain `/uploads/<key>` and are never rewritten. **Never store a
bucket-absolute URL in the database**: it would silently break every existing
image on migration. `S3_PUBLIC_URL` is a serving detail, not a stored value.

**`src/server/filetype.ts` is the upload security boundary.** The request's
`Content-Type` and filename are attacker-controlled; a file that *is* HTML but is
labelled `image/png`, served back under the client's claimed type, is stored XSS
on this origin. So the extension and the served Content-Type are both derived
from the bytes. When adding a format, add its magic signature here and nothing
else — and note SVG is deliberately excluded because it can carry script.

**Branch on `driver`, never on `configured`.** `STORAGE_DRIVER=local` has to be a
hard override even when credentials are present in the environment, so the S3
client is only constructed for the s3 driver. Branching on "are credentials set"
makes the override a lie.

**`/uploads/*` is not under `/api`.** Anything that routes `/api` must route
`/uploads` too — that is why `vite.config.ts` has a second proxy entry, and why
the SPA fallback had to learn to keep its hands off both.

**Tests must stay off the real database and upload directory.** `bunfig.toml`
preloads `test/setup.ts`, which pins `DATABASE_URL=:memory:`,
`STORAGE_DRIVER=local` and a temp `UPLOAD_DIR` *before* any module reads its
config. Do not rely on setting env vars inside a test file — that was
order-dependent and once created a real `bunbolt.db` in the repo.

**The s3 storage branch is tested out-of-process** (`test/s3.test.ts` spawning
`test/s3-probe.ts`), because `storage.ts` reads its configuration at import time
and the preload pins the test process to local. The probe blanks every `S3_*`
variable first so a developer's real `.env` cannot leak in and make the
assertions pass for the wrong reason.

**Templates are compiled as plain JS.** No TypeScript syntax survives in a Vue
template — no `!` assertions, no `(v: boolean) =>` on inline handlers. Inline
handlers with arguments do **not** receive `$event` implicitly; write
`@update:model-value="fn(thread, 'isPinned', $event)"`.

**`tsc --noEmit` does not check `.vue` files** (they are shimmed in
`src/web/env.d.ts`) and Vite does not typecheck. `bun run build` is the real
frontend check: it catches unresolved imports, missing exports and broken
templates, but not wrong prop names. There is no `vue-tsc` — add one if template
type errors start costing more than the dependency.

## Conventions

- `"type": "module"` + `verbatimModuleSyntax: true` — use `import type` for types
- Timestamps are ISO-8601 UTC **strings** everywhere, never DB timestamp types:
  identical across engines, and they sort correctly as text
- Errors are `{ error: string }` with a Chinese user-facing message; the client
  turns them into `ApiError`
- `src/shared/types.ts` must stay dependency-free — the browser imports it
- The first registered account becomes admin (self-hosted convention)

## Gotchas

- No `.env` loading code — Bun loads `.env` itself
- `SESSION_SECRET` is required when `NODE_ENV=production`; the server refuses to
  start without it rather than silently using the dev fallback
- `bun.lock` is committed — run `bun install` after dependency changes
- Deleting a thread's opening post is rejected (`OPENING_POST`); delete the
  thread instead. Post/reply cascades are enforced by the DDL, not by app code.
