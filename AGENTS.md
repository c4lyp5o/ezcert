# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md) as well.

## What this is

EzCert is a multi-tenant event attendance and PDF certificate app.
- **Backend:** Bun + Elysia + Drizzle (Postgres), in `src/`.
- **Frontend:** SvelteKit 5 SPA, in `client/`.

Read [README.md](README.md) for the API table and user flows.

## Commands

| Task                    | Command                                   |
| ----------------------- | ----------------------------------------- |
| Install                 | `bun run install:all`                     |
| Dev (API + client)      | `bun run dev`                             |
| Tests (no DB needed)    | `bun run test`                            |
| Type-check server+client| `bun run typecheck`                       |
| Build client → `dist/`  | `bun run build:all`                       |
| Apply schema to DB      | `bun run db:push` (touches the real DB in `.env`; ask first) |

Before declaring work done, run `bun run test` and `bun run typecheck`. If the client changed, also run `bun run build:all`.

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
- The client uses `adapter-static` with an SPA fallback, so pages must not rely on SSR (`ssr = false` at the root layout).
- Superadmin UI routes are deliberately obscure (`/acolyte`, `/acolyte/altar`), and some API names are themed (`/souls` = tenants, `conjurations` = event count). Keep these names; the client depends on them.
- On Windows the repo uses CRLF on checkout (`core.autocrlf`). Write files with LF; git normalises them.
