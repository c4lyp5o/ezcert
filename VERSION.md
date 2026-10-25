# Version

**Current release:** `1.0.0`
**Next release:** `2.0.0` (unreleased; contains breaking API changes, see [CHANGELOG.md](CHANGELOG.md))

The source of truth for the version is `version` in the root `package.json`. Keep this file, `client/package.json` and the changelog in sync with it.

## Versioning policy

EzCert follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Bump      | When                                                                                   |
| --------- | -------------------------------------------------------------------------------------- |
| **MAJOR** | Breaking change to the HTTP API (removed/renamed routes or fields, stricter validation that rejects previously-accepted input, changed status codes), DB schema changes that need manual migration, or removed env vars. |
| **MINOR** | New features, routes, optional fields, env vars or certificate templates that stay backward compatible. |
| **PATCH** | Bug and security fixes with no API or schema change.                                   |

Schema changes that `bun run db:push` applies safely (new nullable or defaulted columns) are MINOR. Anything that drops or renames columns is MAJOR and must include migration notes in the changelog.

## Release checklist

1. Make sure `bun run test` and `bun run typecheck` pass and `bun run build:all` succeeds.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `[X.Y.Z] - YYYY-MM-DD` heading, and update the compare links at the bottom.
3. Bump `version` in `package.json` and `client/package.json`.
4. Update **Current release** above.
5. Commit with `chore: release vX.Y.Z`, then tag with `git tag vX.Y.Z` and push the tag.
6. Deploy, then run `bun run db:push` if the release changes the schema.
