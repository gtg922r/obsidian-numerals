# Recovery toolchain and release policy

Package B starts at `90a70e41d4ee02b48ebbe5f58856a54f139ae56b` and targets `chore/recovery-1.11`. Candidate package, both lockfile version fields, and manifest are `1.11.0`; candidate `minAppVersion` is `1.13.0`. These changes must never reach master's stable distribution metadata. Only the owner merges or publishes.

## Local and CI checks

Use Node 24 (`.nvmrc`) and npm 11, then `npm ci` and `npm run check`. The aggregate command runs lint, strict production/test/script typechecks, the existing Jest suite, toolchain regression tests, a production build, mathjs symbol checks, a repeated-build byte comparison, and candidate metadata validation. `npm run build` validates candidate metadata and production types before bundling.

`tsconfig.json` includes production source; `tsconfig.test.json` also checks every test and mock; `tsconfig.scripts.json` checks TypeScript tooling and its source imports. All retain strict mode and the existing dependency-declaration `skipLibCheck` setting. No test diagnostics are disabled, and no source or mock typing fixes were needed. Jest transforms use the test config; independent `tsc` remains necessary because isolated ts-jest transformation is not a semantic typecheck.

TS, Jest and ESLint explicitly exclude nested `worktrees`, `.worktrees`, `.codex` and `.git` directories. Temporary regression projects prove that real source/test/script type errors fail, while deliberately broken nested-worktree files do not enter the checks. Existing manual Obsidian mocks remain discoverable.

PR and integration CI use `npm ci` and a read-only token. The reusable checks job packages release assets only after a tag matches synchronized metadata and its commit belongs to the recovery integration history. Checkout does not persist credentials. The separate publishing job runs no checkout, npm install, or project/PR code. There is no `pull_request_target` or `workflow_run` path.

### Verified Actions (2026-09-13)

All actions are pinned to immutable commits. The four requested action manifests declare `runs.using: node24`:

| Action | Verified release | Commit |
| --- | --- | --- |
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | 7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0) | 7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| [softprops/action-gh-release](https://github.com/softprops/action-gh-release/releases/tag/v3.0.3) | 3.0.3 | `efb35369e0ad2afab669f228072c1b0d510eae64` |
| [actions/attest](https://github.com/actions/attest/releases/tag/v4.2.2) | 4.2.2 | `1e69f48acb82d1966a394da916b4c1698aa569d6` |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | 7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| [actions/download-artifact](https://github.com/actions/download-artifact/releases/tag/v8.0.1) | 8.0.1 | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |

Publishing grants only contents, attestations and OIDC writes. Organization-registry storage records are disabled with `create-storage-record: false`, so no `artifact-metadata` permission is needed for this personal repository's release assets. See the [attestation action's storage-record documentation](https://github.com/actions/attest/tree/v4.2.2#artifact-metadata-storage-records).

Workflow YAML was validated with official `actionlint` 1.7.12 (download checksum verified). Parsed workflow regression checks also protect the required check sequence, read-only PR permissions, pinned actions, absence of project execution in publishing, and explicit prerelease options.

## Owner-only prerelease procedure

1. Review and merge focused PRs into `chore/recovery-1.11`. Use the next unused production-shaped version after a published candidate; never move a tag or replace assets.
2. For subsequent candidates, run `npm run version:patch` (or the explicitly intended minor/major command). The script synchronizes package, lockfile and manifest, preserves tab formatting, and leaves `versions.json` unchanged. Commit the candidate for review. `npm run version:bump` is the generic patch-default command; the old npm `version` lifecycle hook was removed to prevent `npm version` from invoking a second increment. Direct `npm version` is not the supported candidate workflow and metadata mismatch fails validation.
3. Only the owner runs `npm run release:beta` from the clean integration branch at its remote reviewed tip. It fetches recovery/master refs, verifies protected stable blobs, rejects existing local/remote tags or GitHub releases, runs `npm ci` and all checks, verifies HEAD and metadata again, and pushes one new tag without force.
4. Tag CI repeats the checks with locked dependencies, verifies the tag resolves to the checked-out reviewed commit, then packages `main.js`, the unchanged candidate `manifest.json`, and `styles.css`. No `manifest-beta.json` is used.
5. Publishing lists existing releases successfully before proceeding, attests validated assets, then atomically creates a new release with `prerelease: true` and `make_latest: "false"`. The API creation fails if another publisher created that version in the meantime. Only that newly created prerelease reaches the asset action, which also explicitly sets `prerelease: true`, `make_latest: "false"`, `overwrite_files: false`, and `fail_on_unmatched_files: true`. Same-tag workflow runs are serialized.

`npm run release` and `npm run release:production` unconditionally fail without writes. There is no production promotion path or environment-variable bypass. Missing/auth-failed/network-failed release queries stop publication; they never imply that a release is absent. A failed tag push leaves the local tag for owner inspection. An asset upload failure after creation may leave an incomplete prerelease: reruns deliberately refuse to modify it. Use a new reviewed candidate; do not overwrite assets or promote the failed release.

Stable guards protect historical `versions.json` bytes (SHA-256 `b22a24bcecf33760e5319eae5439fc2ba5041478f19d58c743f57b6dc0199e01`) and remote master's manifest/versions Git blobs (`a8f7f565d79833c333f77f4acfc3e540a8c69b14` / `51aa485d3ba838dcef42ab89206b36d4e2e07136`). Tests use disposable repositories to prove positive tag creation and negative version/tag/prerelease cases without touching the live vault, real tags, releases or remote stable refs.

## Dependency assessment (2026-09-13)

GitHub's fresh open-alert API reported 23 alerts: 17 high, 3 medium/moderate and 3 low. Every alert's dependency scope was `development`. Multiple advisories and installed paths explain why these counts differ from npm's package-level totals. Fresh baseline `npm audit --json` reported 9 vulnerable packages (6 high, 1 moderate, 2 low); it additionally detected `ws` and newer advisory instances not separately listed by GitHub.

Compatible transitive fixes were applied with `npm audit fix --package-lock-only --ignore-scripts`, followed by the explicitly scoped esbuild 0.28.2 update. No `--force` upgrade was used. The patched YAML parser is an explicit development dependency for workflow-policy tests.

| Development package | Baseline versions | Fixed versions |
| --- | --- | --- |
| `@babel/core` | 7.29.0 | 7.29.7 |
| `baseline-browser-mapping` | 2.10.29 | 2.11.23 |
| `brace-expansion` | 1.1.14 / 2.1.0 / 5.0.6 | 1.1.18 / 2.1.4 / 5.0.9 |
| `browserslist` | 4.28.2 | 4.28.9 |
| `esbuild` | 0.27.3 | 0.28.2 |
| `fast-uri` | 3.1.2 | 3.1.7 |
| `form-data` | 4.0.5 | 4.0.6 |
| `js-yaml` | 3.14.2 / 4.1.1 | 3.15.2 / 4.3.2 |
| `ws` | 8.20.1 | 8.21.3 |

Final full `npm audit --json` and runtime-only `npm audit --omit=dev --json` both report zero vulnerabilities. Every pre-existing runtime lockfile node is unchanged, including mathjs 15.2.0 and fast-deep-equal 3.1.3. No mathjs features or formatter code were removed. Obsidian's installed 1.12.3 types and eslint-plugin-obsidianmd 0.1.9 are unchanged; the declarative host API/settings/linter migration remains Package E's responsibility.

Zero known audit findings are a point-in-time result, not a claim that dependencies are risk-free. GitHub's default-branch alerts remain tied to master's lockfile; this candidate audit does not change stable distribution or dismiss those alerts. Jest 29's development tree still emits deprecation notices for inflight, glob 7, abab, domexception and whatwg-encoding. Migrating Jest/jsdom major versions is separate work. The esbuild issue concerned its Windows development server; Numerals uses the bundler/watch API, and the patched release is still used to remove the advisory.

## Evidence and remaining coverage

Local validation uses macOS arm64, Node 24.12.0 and npm 11.6.2. All 536 existing Jest tests pass, as do the production/test/script typechecks, lint, symbol checks and toolchain guard tests. The repeated production build's `main.js` SHA-256 is `19f91dfc32abb7eb1dfd1128fc636de651b3c4ed1d4e972735468189376c35b7`. Generated outputs are ignored and must not be committed.

This package does not establish live Obsidian 1.13, desktop/mobile or BRAT installation behavior. No release was published, no existing tag or asset was modified, and no live-vault plugin artifact was touched. The tag publishing workflow still requires owner execution/verification after integration; unit fixtures do not prove GitHub publication or host behavior.

The ignored local environment file `.codex/environments/environment.toml` currently sets `setup.script = "npm install --package-lock=false"`. Propose changing that setup through the Codex environment editor to `npm ci`; do not commit this local configuration or run its live Obsidian reload actions. Actual Package B validation uses clean `npm ci` independently of that setup.
