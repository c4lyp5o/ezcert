# Contributing to EzCert

Thanks for helping out! This guide covers local setup, the workflow we expect, and what a mergeable change looks like.

## Setup

Requirements: [Bun](https://bun.sh) 1.3.x and PostgreSQL (only needed to run the app; tests don't need it).

```bash
bun run install:all
cp .env.example .env      # fill in values; never commit .env
bun run db:push
SUPER_USERNAME=oracle SUPER_PASSWORD='a-long-secret' bun run db:seed-super
bun run dev               # API :5000, client :3000
```

See the [README](README.md) for architecture, the API table and env vars.

## Workflow

1. Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/…`, `chore/…`.
2. Keep changes focused. Unrelated refactors go in their own PR.
3. Write or update tests alongside the change (see below).
4. Run the checks:
   ```bash
   bun run test
   bun run typecheck
   bun run build:all
   ```
5. Add an entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md). Mark breaking API changes as **Breaking**.
6. Open a PR describing what changed, why, and how you tested it.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. Add `!` for breaking changes (for example `feat!: require ISO dates on event creation`).

## Code guidelines

### Server (`src/`)
- **Auth:** protect routes with `.use(authPlugin).guard({ adminAuth: true })` or `superAuth`. Never trust IDs from the request body for ownership; use `user.tenantId` from the token.
- **Ownership checks:** scope writes in the `WHERE` clause (`and(eq(events.id, id), eq(events.tenantId, user.tenantId))`) and return `404` when nothing matched.
- **Validation:** every body and param gets a `t.Object(...)` schema (`format: "uuid"`, `format: "email"`, length limits).
- **Responses:** select explicit columns. Never return password hashes or internal fields from public routes.
- **Logging:** use `logger` from `src/logger.ts`, not `console`. Log security-relevant events (`warn`) and state changes (`info`). Never log passwords, tokens or request bodies.
- **Style:** tabs, double quotes, trailing commas, matching the existing files.

### Client (`client/`)
- Svelte 5 runes (`$state`, `$derived`, `$props`). Update arrays immutably (`events = events.map(...)`).
- All API calls go to relative `/api/v1/...` paths (the dev server proxies them).
- Run `bun run check` in `client/`; it must report 0 errors and 0 warnings.
- Style: 2-space indent, Tailwind classes.

### Database
- Edit `src/db/schema.ts`, then `bun run db:push` locally. Note schema changes in the changelog.
- Tests build their schema from `schema.ts` automatically.

## Tests

- Put tests in `tests/*.test.ts`. They run against in-memory PGlite with Nodemailer stubbed (`tests/setup.ts`).
- Use the helpers in `tests/helpers.ts` (`call`, `tenantSession`, `superSession`, `createEvent`, …) instead of hand-rolling requests.
- Every bug fix needs a regression test. Every new route needs auth, validation and happy-path tests.
- `TEST_LOG_LEVEL=debug bun run test` shows server logs while debugging.

## Security

Do not open public issues for vulnerabilities. Report them privately to the maintainers. If a secret is ever committed, rotate it immediately; deleting the commit is not enough.
