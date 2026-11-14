# Contributing

## Setup

```sh
bun install
bun run check   # lint, typecheck, tests, build and package checks: what CI runs
```

| Script                      | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `bun run test`              | Unit and type tests (Vitest). No network.                          |
| `bun run test:live`         | Read-only checks against the real API. Needs `ARBOX_API_KEY`.      |
| `bun run lint` / `lint:fix` | Biome lint and format                                              |
| `bun run typecheck`         | `tsc --noEmit`                                                     |
| `bun run build`             | ESM + CommonJS + types into `dist/` (tsdown)                       |
| `bun run package:check`     | publint and "are the types wrong" on the packed package            |
| `bun run spec:fetch`        | Download Arbox's latest OpenAPI document into `openapi/arbox.json` |
| `bun run generate`          | Regenerate `src/generated/` and the README API table from the spec |

## How the code is organized

- `openapi/arbox.json`: the snapshot of Arbox's OpenAPI document. Change it only with `bun run spec:fetch`.
- `scripts/names.ts`: the SDK method name for each operation. The only hand-written mapping.
- `src/generated/`: produced by `bun run generate`. Don't edit it by hand; CI fails if it doesn't match the spec.
- `src/core/`: the transport (requests, retries, timeouts) and the errors.
- `src/testing/`: the in-memory mock published as `arbox-sdk/testing`.

When Arbox adds an operation, `bun run generate` stops and names it. Add a method name for it in `scripts/names.ts` and run it again.

## Live tests

`tests/live` calls the real API with a `readOnly` client, so it can only send `GET` requests, and checks each response against the spec's schema. Failures report the field path and the rule that failed, never the values, because responses contain member data.

```sh
ARBOX_API_KEY=... bun run test:live
```

Never commit an API key, a recorded response from a real studio, or fixtures with real member data.

## Commits and releases

Pull requests are squash-merged, and the PR title becomes the commit message, so titles follow [Conventional Commits](https://www.conventionalcommits.org) (a check enforces it):

| Title                                          | Release |
| ---------------------------------------------- | ------- |
| `fix: …`, `perf: …`                            | patch   |
| `feat: …`                                      | minor   |
| `feat!: …` or a `BREAKING CHANGE:` footer      | major   |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:` | none    |

Every merge to `main` runs [semantic-release](https://semantic-release.gitbook.io): it picks the version from the commits, publishes to npm with provenance through npm trusted publishing (no npm token is stored in the repo), tags the commit and writes the GitHub release notes.

### First release (one time)

npm trusted publishing can only be configured for a package that already exists, so the first version is published by hand:

```sh
npm login
npm version 0.1.0 --no-git-tag-version
bun run build
npm publish --access public
git checkout package.json
git tag v0.1.0 && git push origin v0.1.0
```

Then, on npmjs.com, open the package's **Settings → Trusted publishing**, choose GitHub Actions, and enter `alon710` / `arbox-sdk` / `release.yml`. From then on every release comes from CI. Until both the package and a `v*` tag exist, the release workflow skips with a notice.
