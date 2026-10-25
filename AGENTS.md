# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md) as well.

## What this is

EzCert is a multi-tenant event attendance and PDF certificate app.
- **Backend:** Bun + Elysia + Drizzle (Postgres), in `src/`.
- **Frontend:** SvelteKit 3 (Svelte 5, Vite 8) SPA, in `client/`.

Read [README.md](README.md) for the API table and user flows.

## Commands

| Task                    | Command                                   |
| ----------------------- | ----------------------------------------- |
| Install                 | `bun run install:all`                     |
| Dev (API + client)      | `bun run dev`                             |
| Tests (no DB needed)    | `bun run test` (server), `bun run test:client` (client) |
| Type-check server+client| `bun run typecheck`                       |
| Build client → `dist/`  | `bun run build:all`                       |
| Apply schema to DB      | `bun run db:push` (touches the real DB in `.env`; ask first) |

Before declaring work done, run `bun run test` and `bun run typecheck` (plus `bun run test:client` if the client changed). If the client changed, also run `bun run build:all`. CI (`.github/workflows/ci.yml`) runs these three on every push and PR to `main` and `development` (tests via `bun run test:coverage`, uploaded to Codecov); keep it green. Work on a branch off `development` and open PRs into it.

## Architecture map

- `src/app.ts`: builds the Elysia app (CORS, request/error logging, modules). Tests import this.
- `src/index.ts`: only calls `app.listen`.
- `src/plugins/auth.ts`: JWT plugins (`jwtTenant`, `jwtSuper`, `jwtMagic`), the `adminAuth` / `superAuth` macros, and `cookieOptions`. Each module does `.use(authPlugin)`; Elysia dedupes it by name.
- `src/modules/*.ts`: one Elysia instance per route group (`register`, `auth`, `admin`, `superadmin`, `public`).
- `src/db/schema.ts`: tables `super_admins`, `tenants`, `events`, `attendees`, plus relations.
  - Tenant status flow: `PENDING` → `AWAITING_ACTIVATION` → `ACTIVE` (or `REJECTED`).
- `src/cert-templates.ts`: built-in PDFKit designs. `TEMPLATE_IDS` is the single source of valid template IDs; API validation uses it.
- `src/designs/`: tenant-built certificate designs.
  - `layout.ts`: layout schema, placeholders and fonts, in A4 points. Use `pageSize(layout.orientation)` for page dimensions, never hard-coded sizes; a missing orientation means landscape. The schema allows both orientations, and `layoutBoundsError()` checks the real page. The client mirrors it in `client/src/lib/designs.svelte.ts`; keep the two in sync.
  - `render.ts`: draws a layout.
  - `certificate.ts`: picks the custom design or the built-in template.
  - `images.ts`: upload sanitiser.
  - `pptx-import.ts`: a pure PPTX → draft converter.
  - `starter.ts`: the downloadable template.
- `src/modules/designs.ts`: asset and design routes (quotas, rate limit, ownership checks).
- `src/storage.ts`: local-disk storage under `UPLOAD_DIR`. Keys are server-generated and validated.
- `src/logger.ts`: deadslog instance.
- `client/src/**/*.test.ts`: Vitest tests for `src/lib` and the page `load` functions. `designs.svelte.test.ts` imports the server's `src/designs/layout.ts` and fails if the client's placeholders, fonts, sample values or page sizes drift from it. Svelte components have no tests yet.
- `.github/`: `workflows/ci.yml` (test, typecheck, build) and `dependabot.yml` (weekly; ignores `bun-types` minor/major and client TypeScript major on purpose).
- `tests/setup.ts`: preload that mocks `src/db` with PGlite and `nodemailer` with `mailbox`, and truncates tables before each test.

## Rules

1. **Auth and ownership.** Tenant routes must sit behind `guard({ adminAuth: true })` and take the tenant from `user.tenantId`, never from the request body. Enforce ownership in SQL `WHERE` clauses and return `404` on no match.
2. **Validate everything** with Elysia `t` schemas, and validate UUID params with `format: "uuid"`.
3. **Never leak secrets:** no password hashes in responses (select explicit `columns`), and no logging of passwords, tokens or bodies.
4. **Log with `logger`, not `console`.** Use `warn` for security-relevant failures, `info` for state changes and `debug` for noise.
5. **Add tests** for every behaviour change in `tests/*.test.ts` using `tests/helpers.ts`. Bug fixes need a regression test.
6. **Update `CHANGELOG.md`** under `[Unreleased]`, and flag breaking API changes.
7. **Uploads are untrusted.** Every image, including images extracted from a PPTX, must go through `sanitizeImage()`. Never serve or store user files under user-controlled names, and never accept SVG.
8. **Participant data is encrypted at rest.** Write `attendees.name/email/ic` only through `encrypt()` from `src/crypto/pii.ts`, read them through `decrypt()`, and look participants up by `email_hash`, never by plaintext.
   - Never return a full IC except from the CSV export and the certificate PDF (only via the `{{ic}}` placeholder). The verify page and dashboard get masked or no IC.
   - Never log names, emails (use `maskEmail`) or ICs.
   - A new personal-data field needs the same treatment plus a migration.
9. **Don't touch** `.env` (git-ignored, contains secrets), lockfiles (unless you're intentionally changing dependencies), or `dist/` (build output).
10. **Match the local style.** Server: tabs, double quotes. Svelte: 2 spaces. Svelte 5 runes, with immutable array updates.

## Gotchas

- `bun-types` is pinned to the installed Bun runtime (`~1.3.x`). Newer `bun-types` break `process.on` typings. Bump both together.
- `bun test` auto-loads `.env`. The test setup forces `LOG_LEVEL=silent` and mocks the DB, so tests never hit the real DB. Keep it that way: don't import `pg` directly in code under test.
- `mock.module` in `tests/setup.ts` must run before `src/app.ts` is imported. Don't import app code from `setup.ts`.
- **No top-level `await` in `src/index.ts` or anything it imports (e.g. `src/db/index.ts`).** PM2 loads the entry with `require()`, and Bun refuses that when a top-level `await` really suspends (the container crash-looped on it). Startup waits on `dbReady` instead. `tests/pm2-load.test.ts` loads the entry the way PM2 does, against a fake Postgres.
- The client uses `adapter-static` with an SPA fallback, so pages must not rely on SSR (`ssr = false` at the root layout).
- SvelteKit 3: there is no `svelte.config.js`. Kit options (adapter, preprocess) are passed to `sveltekit()` in `client/vite.config.ts`. Import from `src/lib` with `#lib/...` and include the file extension (`#lib/auth.svelte.js`, not `$lib/auth.svelte`); the alias lives under `imports` in `client/package.json`. The `goto` options are `replace` and `reset`, not `replaceState` and `noScroll`.
- The client needs TypeScript 6 (SvelteKit 3), while the server type-check is pinned to 5.9.3 in the root `typecheck` script (the TypeScript 7 native build crashes under `bunx`). Don't unify them.
- Superadmin UI routes are deliberately obscure (`/acolyte`, `/acolyte/altar`), and some API names are themed (`/souls` = tenants, `conjurations` = event count). Keep these names; the client depends on them.
- On Windows the repo uses CRLF on checkout (`core.autocrlf`). Write files with LF; git normalises them.
