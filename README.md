# EzCert

Easy event attendance with certificate generation. Organisations (tenants) register, are approved by a superadmin, create events, and share a QR code. Attendees check in on their phone and download a PDF certificate immediately.

[![CI](https://github.com/c4lyp5o/ezcert/actions/workflows/ci.yml/badge.svg)](https://github.com/c4lyp5o/ezcert/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/c4lyp5o/ezcert/graph/badge.svg)](https://codecov.io/gh/c4lyp5o/ezcert)
[![License: MIT](https://img.shields.io/github/license/c4lyp5o/ezcert)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/c4lyp5o/ezcert/main)](https://github.com/c4lyp5o/ezcert/commits/main)
[![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)](https://bun.sh)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-3-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/docs/kit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%20%7C%206-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](.github/dependabot.yml)

[Changelog](CHANGELOG.md) · [Versioning](VERSION.md) · [Contributing](CONTRIBUTING.md) · [Agent guide](AGENTS.md)

## Stack

| Layer    | Tech                                                                 |
| -------- | -------------------------------------------------------------------- |
| API      | [Bun](https://bun.sh) + [Elysia](https://elysiajs.com), JWT cookies  |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team)               |
| PDFs     | [PDFKit](https://pdfkit.org), streamed per request                   |
| Email    | Nodemailer (SMTP)                                                    |
| Images   | [sharp](https://sharp.pixelplumbing.com) (upload sanitising), fflate + fast-xml-parser (PPTX import) |
| Logging  | [deadslog](https://www.npmjs.com/package/deadslog)                   |
| Client   | SvelteKit 3 (SPA, `adapter-static`) + Svelte 5 + Vite 8 + Tailwind 4 + bits-ui |
| Tests    | `bun test` + in-memory Postgres ([PGlite](https://pglite.dev)); Vitest for the client |

## Project layout

```
src/
  index.ts            # entrypoint: starts the server
  app.ts              # Elysia app (CORS, request/error logging, modules), imported by tests
  logger.ts           # deadslog instance (LOG_LEVEL, LOG_FILE_PATH)
  plugins/auth.ts     # JWT plugins + adminAuth / superAuth macros, shared cookie options
  plugins/rate-limit.ts # per-IP rate limiter (check-in, uploads)
  modules/            # route groups: register, auth, admin, superadmin, public, designs
  db/                 # Drizzle schema + Postgres connection (ssl.ts = TLS policy)
  crypto/             # field encryption for participant data + legacy-row migration
  designs/            # custom certificate designs: layout, renderer, PPTX import, image sanitiser
  storage.ts          # local-disk uploads under UPLOAD_DIR
  cert-templates.ts   # built-in PDF certificate designs (TEMPLATE_IDS)
  email-templates.ts  # activation email HTML
scripts/              # one-off scripts (db:encrypt-pii)
client/               # SvelteKit 3 app (config in vite.config.ts), builds into ../dist
tests/                # API + template tests (see Testing)
.github/              # CI workflow and Dependabot config
```

## Getting started

Requirements: Bun 1.3.x, Node 22.17+ (used by the client tooling) and PostgreSQL (tests don't need a database).

```bash
bun run install:all          # server + client deps
cp .env.example .env         # then fill in the values
bun run db:push              # create/update tables from src/db/schema.ts
SUPER_USERNAME=oracle SUPER_PASSWORD='a-long-secret' bun run db:seed-super   # first superadmin
bun run dev                  # API on :5000, client on :3000 (proxies /api → :5000)
```

### Environment variables

See [`.env.example`](.env.example). Notes:

- In `NODE_ENV=production` the server **refuses to start** if `JWT_SECRET`, `SUPER_JWT_SECRET` or `MAGIC_JWT_SECRET` is missing. In development they fall back to insecure defaults.
- `DOMAIN_NAME` is used for activation links and as the only allowed CORS origin.
- `.env` is git-ignored. Never commit it.

## User flows

1. **Tenant registers** (`/register`) → status `PENDING`.
2. **Superadmin approves** in the altar (`/acolyte` → `/acolyte/altar`) → status `AWAITING_ACTIVATION`, activation email sent. Approving again re-sends the email.
3. **Tenant activates** via the emailed link (`/activate?token=…`, valid 1h) → `ACTIVE`, can log in at `/login`.
4. **Tenant creates events** in `/admin`, picks a certificate template, opens check-in, and shares the QR code or link.
5. **Attendee checks in** at `/event/:id` (only while the event is open) and downloads the certificate. Re-submitting the same email returns the same certificate.
6. Tenant exports attendees as CSV, manages or deletes participants, toggles check-in, or deletes the event. Organisers and attendees can switch between light and dark mode.

## API

All routes are under `/api/v1`. Auth is via httpOnly cookies: `admin_token` (tenant) and `super_token` (superadmin). Invalid input returns `422`.

| Method | Path                              | Auth   | Description                                         |
| ------ | --------------------------------- | ------ | --------------------------------------------------- |
| POST   | `/register`                       | none   | Register a tenant (`tenantName`, `email`, `password` ≥ 8 chars) |
| POST   | `/auth/activate`                  | none   | Activate with the emailed token                     |
| POST   | `/auth/admin/login`               | none   | Tenant login, sets `admin_token`                    |
| POST   | `/auth/admin/logout`              | none   | Clears `admin_token`                                |
| GET    | `/auth/admin/me`                  | tenant | Current tenant profile                              |
| POST   | `/auth/super/login`               | none   | Superadmin login, sets `super_token`                |
| POST   | `/auth/super/logout`              | none   | Clears `super_token`                                |
| GET    | `/auth/super/me`                  | super  | Current superadmin (`id`, `username`)               |
| PATCH  | `/admin/tenant`                   | tenant | Update name/email (`409` if email taken)            |
| GET    | `/admin/events`                   | tenant | Own events, newest first, with attendees            |
| POST   | `/admin/events`                   | tenant | Create event (`name`, ISO `date`, `location`, `template`, `isOpen?`, `collectIc?`) |
| PATCH  | `/admin/events/status/:id`        | tenant | Open/close check-in (`isOpen`)                      |
| PATCH  | `/admin/events/:id/settings`      | tenant | Turn IC collection on/off (`collectIc`)             |
| GET    | `/admin/events/:id/attendees.csv` | tenant | Export participants as CSV (full IC; audit-logged)  |
| DELETE | `/admin/events/:id/attendees/:attendeeId` | tenant | Delete one participant                      |
| DELETE | `/admin/events/:id/attendees`     | tenant | Delete all participants of an event                 |
| DELETE | `/admin/events/:id`               | tenant | Delete own event (cascades attendees)               |
| GET    | `/superadmin/pending`             | super  | Tenants awaiting review                             |
| POST   | `/superadmin/approve`             | super  | Approve + email activation link (`502` if email fails) |
| POST   | `/superadmin/reject`              | super  | Reject a pending tenant                             |
| GET    | `/superadmin/souls`               | super  | Non-pending tenants with event counts               |
| DELETE | `/superadmin/souls/:id`           | super  | Delete tenant (cascades events + attendees)         |
| GET    | `/superadmin/events`              | super  | All events                                          |
| PATCH  | `/admin/events/:id/certificate`   | tenant | Switch built-in `template` / custom `designId`      |
| GET    | `/admin/assets`                   | tenant | Own uploaded images                                 |
| POST   | `/admin/assets`                   | tenant | Upload image (multipart `file`, `kind`: logo, signature, image, background) |
| GET    | `/admin/assets/:id/file`          | tenant | Image bytes (owner only)                            |
| DELETE | `/admin/assets/:id`               | tenant | Delete image (`409` if a design uses it)            |
| GET    | `/admin/designs`                  | tenant | Own designs                                         |
| GET    | `/admin/designs/:id`              | tenant | Design with layout                                  |
| POST   | `/admin/designs`                  | tenant | Create design (`name`, `layout`)                    |
| PUT    | `/admin/designs/:id`              | tenant | Update design                                       |
| DELETE | `/admin/designs/:id`              | tenant | Delete design (events fall back to built-in)        |
| POST   | `/admin/designs/preview`          | tenant | Render a layout with sample data (PDF)              |
| POST   | `/admin/designs/import`           | tenant | Import a `.pptx` (multipart `file`) into a draft    |
| GET    | `/admin/designs/starter.pptx`     | tenant | Download the PPTX starter (`?orientation=landscape\|portrait`) |
| GET    | `/events/:id`                     | none   | Public event details + host name                    |
| GET    | `/events/verify/:attendeeId`      | none   | Verify a certificate                                |
| POST   | `/events/attend`                  | none   | Check in (`name`, `email`, `eventId`, `ic` if the event collects it) |
| GET    | `/events/certificate/:attendeeId` | none   | Download the PDF certificate                        |

Certificate templates: `default`, `tech-dark`, `elegant-gold`, `retro-pixel` (see `src/cert-templates.ts`). Long names and titles shrink to fit on one line.

## Custom certificate designs

Tenants can replace the built-in templates with their own designs at `/admin/designs`:

- **Designer.** Place text (with placeholders), logos, signatures, images, a background colour or picture, and a verification QR code on an A4 **landscape or portrait** canvas, then preview the result as a PDF.
- **PowerPoint import.** Download the landscape or portrait starter `.pptx`, design the first slide in PowerPoint, and import it. Orientation is detected from the slide shape. Text boxes (position, font, size, colour, alignment), pictures and solid or picture backgrounds are converted into an editable design.
  - A text box containing only `{{qr}}` becomes the QR code.
  - Shapes, gradients, groups and tables aren't imported, and the importer lists anything it skipped. Put decorations in a background picture instead.
- **Placeholders:** `{{attendee_name}}`, `{{event_name}}`, `{{date}}`, `{{location}}`, `{{host_name}}`, `{{certificate_id}}`, and for events that collect IC, `{{ic}}` (full) and `{{ic_masked}}` (`******-**-1234`).
- **Fonts** map to the PDF standard families: Helvetica, Times and Courier.

**Upload safeguards:**
- Files are decoded and re-encoded server-side. Only PNG, JPEG and WebP are accepted; SVG is refused, and metadata is stripped.
- Size limits per kind, plus a per-tenant quota and rate limit.
- PPTX files are checked for zip bombs and macros, and external links are never followed.
- Files are stored under `UPLOAD_DIR/<tenantId>/` with random names and served only to their owner.
- Every certificate can be checked at `/verify/<certificate-id>`.

## Participant data & privacy

| Data | Collected | Stored as | Who sees it |
| ---- | --------- | --------- | ----------- |
| Name | always | AES-256-GCM ciphertext | organiser; on the certificate and its public verify page |
| Email | always | ciphertext + keyed HMAC (to match repeat check-ins) | organiser only |
| IC number | only if the event enables **Collect IC** (for CPD) | ciphertext | organiser sees it masked (`******-**-1234`); full IC in the CSV export (audit-logged) and on the certificate only if the design uses `{{ic}}` |

- **Certificates** are generated on demand from the stored record; PDFs are never stored. A design that uses `{{ic}}` prints the full IC, so anyone holding that certificate link can see it. Use `{{ic_masked}}` unless CPD needs the full number.
- **Retention:** data is kept until the organiser deletes it, either one participant or all participants of an event, from the Participants panel. Deleting a participant also disables their certificate and verify links.
- **Key management:** `DATA_ENCRYPTION_KEY` (32 random bytes, base64) must be backed up separately from the database. Without it, encrypted data can't be recovered. Rows from before encryption are migrated with `bun run db:encrypt-pii`.
- **Database TLS:** production refuses an unencrypted Postgres connection (`DB_SSL=verify`, the default). Use `DB_SSL=no-verify` for self-signed certificates. Use `DB_ALLOW_INSECURE=true` only for a database on a private network.
- **Logs** contain IDs and masked emails only, never names, ICs or request bodies.

## Logging

The server logs through [deadslog](https://www.npmjs.com/package/deadslog) (`src/logger.ts`):

- Every request: `METHOD /path status duration`. Only the path is logged; query strings and bodies never are.
- Unhandled errors with stack traces. Validation errors and 404s go to `debug`.
- Security and audit events: failed logins, activations, approvals and rejections, tenant deletion, cross-tenant access attempts, email failures, DB connection errors.

Configure with `LOG_LEVEL` (default `info`; `silent` disables) and `LOG_FILE_PATH` to also write rotating files (10 MB × 5, gzipped).

## Testing

```bash
bun run test          # API + certificate tests
bun run test:coverage # same, plus a coverage report (coverage/lcov.info)
bun run test:client   # client unit tests (Vitest): design helpers, theme, sessions, page loads
bun run test:watch
bun run typecheck     # server tsc + client svelte-check
```

Tests run against an **in-memory Postgres (PGlite)**, so they need no database or `.env` and never touch real data. The preloaded `tests/setup.ts`:

- creates the schema from `src/db/schema.ts` and swaps in the in-memory DB,
- stubs Nodemailer (`mailbox.sent` / `mailbox.shouldFail`),
- silences logs,
- truncates all tables before each test.

Requests go through `app.handle()`, so no port is opened.

| File                          | Covers                                                         |
| ----------------------------- | -------------------------------------------------------------- |
| `tests/auth.test.ts`          | Registration, logins, sessions, approve → activate → login flow |
| `tests/admin.test.ts`         | Auth guards, event CRUD, tenant isolation, profile updates     |
| `tests/superadmin.test.ts`    | Pending queue, approve/reject rules, email failure, cascades   |
| `tests/public.test.ts`        | Event details, check-in rules, dedupe, PDF + filename safety   |
| `tests/cert-templates.test.ts`| Every template renders on one page with very long text         |
| `tests/designs.test.ts`       | Design CRUD, layout validation, portrait/landscape, previews, tenant isolation |
| `tests/assets.test.ts`        | Image upload sanitising, quotas, rate limit, owner-only access |
| `tests/pptx-import.test.ts`   | PPTX import, starter templates, zip-bomb and macro rejection   |
| `tests/privacy.test.ts`       | Encryption, IC rules and masking, CSV export, deletion, DB TLS policy |

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request to `main` and `development`: install (frozen lockfiles), `bun run test:coverage`, `bun run typecheck` and `bun run build:all`, plus the client tests (Vitest), then uploads server and client coverage to [Codecov](https://codecov.io/gh/c4lyp5o/ezcert) (no token needed; an upload problem never fails the build). It needs no database. Bun is pinned to 1.3.14 to match `bun-types`. [Dependabot](.github/dependabot.yml) opens weekly update PRs (minor/patch grouped); majors are reviewed by hand.

## Building & deployment

```bash
bun run build:all     # builds the client into ./dist
bun run start         # pm2-runtime with ecosystem.config.js
```

`dist/` is a static SPA (fallback `index.html`). Serve it with your reverse proxy and forward `/api` to the Bun server. The `Dockerfile` builds the client and runs the API under PM2.

> **Uploads:** mount `UPLOAD_DIR` (default `/app/uploads` in the container) as a persistent volume, e.g. `-v ezcert-uploads:/app/uploads`. Otherwise uploaded logos and backgrounds are lost when the container is replaced.

> **Secrets:** the image contains no `.env`. Pass configuration at run time: `docker run --env-file .env -p 5000:5000 -v ezcert-uploads:/app/uploads ezcert`. PM2 runs a single process in fork mode (cluster mode is unreliable with Bun, and the rate limiter is per process). CI builds the image and checks that it starts.

## License

[MIT](LICENSE) © 2026 c4lyp5o.
