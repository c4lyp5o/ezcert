# Changelog

All notable changes to EzCert are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (see [VERSION.md](VERSION.md)).

## [Unreleased]

### Fixed: Docker and cleanups
- **Dockerfile no longer copies `.env`.** `.env` is untracked, so image builds from a clean clone failed, and copying it baked secrets into the image. Pass them at run time with `--env-file`. The build also uses frozen lockfiles, sets `UPLOAD_DIR` with a volume, and adds a healthcheck. `.dockerignore` excludes `.env`, `.git`, tests and nested `node_modules`.
- **The container could never start.** `ecosystem.config.js` pointed PM2 at `src/index.js`, which doesn't exist (the file is `index.ts`), and the startup chain used top-level `await` (`await client.connect()` in `src/db/index.ts`), which PM2's Bun wrapper can't `require()`. The database now uses a `pg` pool and startup waits on a `dbReady` promise. A regression test (`tests/pm2-load.test.ts`) loads the entry the way PM2 does. Found by the new CI smoke test; the approach comes from the `eziarr` project.
- `DB_ALLOW_INSECURE=true` alone now opts a production deployment out of database TLS, as `.env.example` always implied (before, it also needed `DB_SSL=disable`, and otherwise the app still demanded TLS). An explicit `DB_SSL` still takes precedence; production without either still defaults to verified TLS.
- PM2 now runs one process in fork mode instead of cluster mode (unreliable with Bun; the in-memory rate limiter is per process).
- Added `favicon.ico` (removes the `/favicon.ico` 404).
- Removed a no-op QR recolour in the dashboard; the check-in QR stays black.

### Added: continuous integration
- GitHub Actions workflow (`.github/workflows/ci.yml`): on every push and PR to `main` and `development` it installs with frozen lockfiles and runs `bun run test`, `bun run typecheck` and `bun run build:all` (Bun 1.3.14, Node 24, no secrets).
- Coverage: `bun run test:coverage` writes `coverage/lcov.info`; CI uploads it to Codecov (`codecov.yml`). The report counts server code only (tests are excluded via `bunfig.toml`).
- MIT `LICENSE`, and a README license section and badge.
- CI also builds the Docker image, checks that `sharp`, `pdfkit` and `nodemailer` load on Alpine, and boots the container.
- README badges: CI, Codecov, license, last commit, Bun, SvelteKit, TypeScript, Dependabot.
- Dependabot (`.github/dependabot.yml`): weekly updates for the server, the client and the workflow actions, with minor/patch grouped. `bun-types` and the client's TypeScript major are held back deliberately.
- Docs: README (stack, layout, API table, test table, CI section), CONTRIBUTING (branching from `development`, SvelteKit 3 and theme conventions), VERSION release steps and AGENTS brought up to date.

### Changed: major dependency upgrades
- Server: `nodemailer` 7 → 10, `pdfkit` 0.17 → 0.20, `@types/nodemailer` 7 → 8, `concurrently` 9 → 10 (dev). Client: `lucide-svelte` 0.561 → 1.0, `qr` 0.5 → 0.7.
- Certificates are unchanged: the PDF drawing instructions of all four built-in templates and the landscape/portrait custom designs are identical before and after. QR codes (SVG and matrix) and email messages are identical too. The PDFs only gain a `/UserUnit 1` entry (the default page unit).
- Held back on purpose: `bun-types` 1.4 (must match the installed Bun) and TypeScript 7 (the native build crashes under `bunx`, and SvelteKit 3 wants 6).

### Changed: SvelteKit 3
- Client upgraded to SvelteKit 3, Vite 8, `@sveltejs/vite-plugin-svelte` 7, `@sveltejs/adapter-static` 4 and TypeScript 6, using `sv migrate sveltekit-3`. Needs Node 22.17+ for the client tooling.
- `svelte.config.js` is gone; its options moved into `sveltekit()` in `client/vite.config.ts`. `$lib` imports became `#lib` subpath imports, and `client/tsconfig.json` extends `$app/tsconfig`.
- No user-facing or API change.

### Added: light/dark theme toggle
- Organiser and attendee pages (landing, login, register, dashboard, designer, check-in, verify) have a light/dark toggle (bottom-right). It defaults to the OS preference and is remembered per browser (`localStorage` key `ezcert-theme`), and is applied before first paint so there is no flash.
- Superadmin pages (`/acolyte`) are unchanged.
- QR codes, certificate swatches and the designer canvas look the same in both themes.

### Added: participant data protection
- **Field encryption at rest:** participant name, email and IC are stored AES-256-GCM encrypted (`enc:v1:…`) with a key from `DATA_ENCRYPTION_KEY` (required; the server refuses to start without it). Repeat check-ins are matched by a keyed HMAC of the email (`attendees.email_hash`), so nothing is decrypted to search.
- **IC number collection for CPD**, opt-in per event (`events.collect_ic`, off by default):
  - Validated as a 12-digit MyKad, then encrypted.
  - Masked (`******-**-1234`) everywhere in the dashboard and API. Never shown on the verify page, never logged.
  - The full IC appears only in the new server-side CSV export (`GET /admin/events/:id/attendees.csv`, audit-logged).
  - Certificate placeholders `{{ic}}` (full IC, for CPD certificates) and `{{ic_masked}}`. Both are blank when the event doesn't collect IC.
- **Participant deletion:** `DELETE /admin/events/:id/attendees/:attendeeId` and `DELETE /admin/events/:id/attendees` (wipe all), plus a Participants panel in the dashboard. Deleted participants' certificate and verify links stop working.
- **Privacy notice** on the check-in form: what's stored, why, for how long, and who to contact.
- **Check-in rate limit:** 60 per minute per IP. It's high on purpose, because a whole room may share one venue Wi-Fi. `TRUST_PROXY=true` uses `X-Forwarded-For`.
- **Database TLS policy** (`DB_SSL=verify|no-verify|disable`): production refuses an unencrypted database connection unless `DB_ALLOW_INSECURE=true`; development logs a warning.
- **Emails masked in logs** (`ja***@example.com`).
- **Migration:** `bun run db:encrypt-pii` encrypts rows created before this change (idempotent). **Schema:** `attendees.email_hash`, `attendees.ic`, `events.collect_ic` and an index. Run `bun run db:push` first.
- The CSV export moved server-side, so the full IC never reaches the browser's JavaScript.

### Added: custom certificate designs
- **Designer** (`/admin/designs`): build certificates on a scaled A4 canvas. Text with placeholders (`{{attendee_name}}`, `{{event_name}}`, `{{date}}`, `{{location}}`, `{{host_name}}`, `{{certificate_id}}`), uploaded logos, signatures and images, a background colour or picture, and a verification QR code. Drag, resize, keyboard nudge, layering and PDF preview.
- **Image uploads** (`/admin/assets`): PNG/JPEG/WebP only, decoded and re-encoded server-side (metadata such as EXIF/GPS stripped, SVG refused, decompression-bomb pixel cap), per-kind size limits (logo/signature 1MB, image 2MB, background 5MB), downscaling, a per-tenant quota (50 files / 50MB), and a rate limit (30 uploads / 10 min). Files are served only to their owner with `nosniff` and a locked-down CSP.
- **PowerPoint import** (`POST /admin/designs/import`): reads the first slide of a `.pptx` (text box positions, fonts, sizes, colours, alignment, pictures, solid or picture backgrounds) into an editable draft with warnings for anything skipped. Hardened against zip bombs (entry and size limits checked before decompression), macro-enabled files, external links and corrupt archives. DOCX is intentionally not supported (flow layout can't be mapped reliably).
- **Starter templates** (`GET /admin/designs/starter.pptx?orientation=landscape|portrait`): A4 PPTX with every placeholder, a `{{qr}}` box and usage notes.
- **Portrait certificates:** designs have an `orientation` (`landscape` default, or `portrait`). It's set in the designer or detected from the PPTX slide shape, and certificates render as A4 pages in that orientation. Element bounds are validated against the chosen page. Designs saved without an orientation stay landscape. Built-in templates remain landscape.
- **Certificate verification**: public `GET /events/verify/:id` and `/verify/:id` page. Built-in templates now print the certificate ID.
- Events can use a custom design (`designId` on create, `PATCH /admin/events/:id/certificate` to switch), with a certificate picker in the dashboard.
- `UPLOAD_DIR` env var; requests over 12MB are rejected before parsing.
- **Schema:** new `assets` and `designs` tables, nullable `events.design_id`. Run `bun run db:push`.

### Security
- Admin routes `POST /admin/events`, `PATCH /admin/tenant` and `DELETE /admin/events/:id` now require a tenant session (they were unauthenticated).
- Event creation takes the tenant from the session token; a `tenantId` in the request body is ignored.
- `GET /auth/super/me` no longer returns the superadmin password hash.
- Superadmin login returns the same message for unknown usernames and wrong passwords.
- Server refuses to start in production without `JWT_SECRET`, `SUPER_JWT_SECRET` and `MAGIC_JWT_SECRET`.
- CORS restricted to `DOMAIN_NAME` when set.
- Certificate download filenames are sanitised (no header injection).
- `.env` removed from version control and git-ignored. **Rotate any secrets from earlier commits.**
- Superadmin seed script reads credentials from `SUPER_USERNAME` / `SUPER_PASSWORD` instead of hard-coded values.

### Added
- Admin dashboard: certificate template picker, "open check-in immediately", attendee count column and total, per-event CSV export, copy link, delete event, QR download from the modal, Escape closes modals.
- Public check-in: "check-in closed" state, error messages, host name, proper 404 page.
- Re-submitting attendance with the same email (case-insensitive) returns the existing certificate.
- Approving an `AWAITING_ACTIVATION` tenant re-sends the activation email.
- Structured logging with [deadslog](https://www.npmjs.com/package/deadslog): request log, unhandled errors, security/audit events, DB connection health. Configurable via `LOG_LEVEL` and `LOG_FILE_PATH`.
- Test suite (`bun run test`): 60 API and template tests against in-memory Postgres (PGlite).
- Scripts: `test`, `test:watch`, `typecheck`, `db:seed-super`.
- `EMAIL_FROM`, `LOG_LEVEL`, `LOG_FILE_PATH` environment variables.
- Docs: README rewrite, CONTRIBUTING, AGENTS, VERSION, this changelog.

### Changed
- **Breaking (API):** request validation tightened, invalid input returns `422`:
  - `POST /register`: valid email, password ≥ 8 characters, non-empty name.
  - `POST /admin/events`: ISO `date-time`, `template` must be a known template ID, `tenantId` field removed.
  - `POST /events/attend`: valid email, UUID `eventId`; closed events are refused.
  - UUID path params are validated on every route.
- **Breaking (API):** `GET /events/:id` returns only public fields plus `hostName` (no `tenantId` or `template`).
- **Breaking (API):** `/superadmin/approve` and `/superadmin/reject` return `404` for tenants not in an approvable/rejectable state; approve returns `502` if the email fails.
- `PATCH /admin/tenant` returns `409` when the email belongs to another tenant.
- Superadmin JWT lifetime aligned with its cookie (1h).
- Auth logic consolidated into `src/plugins/auth.ts`; app construction moved to `src/app.ts`.
- Client builds as an SPA into `../dist` (the Dockerfile's expected path).
- Dependencies updated within their semver ranges; `elysia` and `bun-types` pinned instead of `latest`.

### Fixed
- Logout (tenant and superadmin) called non-existent endpoints and never cleared the cookie.
- Toggling event status appended the create-form object to the events list.
- Delete event and profile update called wrong URLs; superadmin "vanquish" URL typo.
- Event date input started with an invalid value; dates are now sent as absolute ISO timestamps.
- Superadmin approve/reject ignored server failures in the UI.
- Login page called a non-existent `/auth/verify` endpoint.
- `EMAIL_PASSWORD` (documented) was ignored in favour of `EMAIL_PASS`; both now work.
- Certificate footer lines overlapped; long names/titles wrapped onto each other (now shrink to fit).
- Client production build failed on the dynamic `/event/[id]` route.
- `tsc` failed on the removed `moduleResolution: node` option.
- Unused `DatePicker` component type errors.

## [1.0.0]

- Initial version: tenant registration and superadmin approval, magic-link activation, event management with QR codes, public check-in and PDF certificates with four built-in templates.

[Unreleased]: https://github.com/c4lyp5o/ezcert/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/c4lyp5o/ezcert/releases/tag/v1.0.0
