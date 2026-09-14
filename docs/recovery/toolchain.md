# Recovery toolchain and release policy

Package B starts at `90a70e41d4ee02b48ebbe5f58856a54f139ae56b` and targets `chore/recovery-1.11`. Candidate package, both lockfile version fields, and manifest are `1.11.0`; candidate `minAppVersion` is `1.13.0`. These changes must never reach master's stable distribution metadata. Only the owner merges or publishes.

## Local and CI checks

Use Node 24 (`.nvmrc`) and npm 11, then `npm ci` and `npm run check`. The aggregate command runs lint, strict production/test/script typechecks, the existing Jest suite, toolchain regression tests, a production build, mathjs symbol checks, a repeated-build byte comparison, and candidate metadata validation. `npm run build` validates candidate metadata and production types before bundling.

`tsconfig.json` includes production source; `tsconfig.test.json` also checks every test and mock; `tsconfig.scripts.json` checks TypeScript tooling and its source imports. All retain strict mode and the existing dependency-declaration `skipLibCheck` setting. No test diagnostics are disabled, and no source or mock typing fixes were needed. Jest transforms use the test config; independent `tsc` remains necessary because isolated ts-jest transformation is not a semantic typecheck.

TS, Jest and ESLint explicitly exclude nested `worktrees`, `.worktrees`, `.codex` and `.git` directories. Temporary regression projects prove that real source/test/script type errors fail, while deliberately broken nested-worktree files do not enter the checks. Existing manual Obsidian mocks remain discoverable.

PR and integration CI use `npm ci` and a read-only token. The reusable checks job packages assets for the release publisher only after a tag matches synchronized metadata and its commit is the exact current recovery integration tip. Earlier ancestors are rejected: an intermediate feature commit can be in the history without being an independently reviewed release candidate. The owner holds integration fixed throughout tag validation and publication. Checkout does not persist credentials. The separate publishing job runs no checkout, npm install, or project/PR code. There is no `pull_request_target` or `workflow_run` path.

### Candidate artifacts for installed acceptance

The current recovery path is focused local installed testing plus the existing reviewed automated checks. GitHub-hosted installed Obsidian execution is deferred optional roadmap work; its disabled helper and 83 `NOT_RUN` catalog rows are not recovery gates. The earlier workflow-permission request is superseded. Existing CI artifact production, helper pure checks and extraction evidence are unchanged; none alone proves installed Numerals behavior.

Successful ordinary recovery push and PR checks also upload `numerals-acceptance-<checked-out SHA>`, retained for 14 days. Packaging runs after every required lint, type, Jest, toolchain, build, symbol, reproducibility and candidate-metadata check succeeds. It reads the synchronized candidate version with `readCandidate()` and invokes the same `prepare-release-artifacts.mjs` used by tag validation. The upload explicitly includes only `main.js`, `manifest.json` and `styles.css`; all three must exist, and their bytes (including the canonical manifest) are copied unchanged. No provenance file, vault data, configuration or profile is included.

The artifact name records `git rev-parse HEAD` from the actual checkout, also printed in the packaging log. On a PR event this is the tested synthetic merge commit (`github.sha`), **not** the PR head commit. On an integration push it is the pushed integration commit. A version string or a successful PR artifact alone does not establish an accepted candidate.

Before installed acceptance, the owner selects a successful **push** run from the reviewed `chore/recovery-1.11` integration commit. Independently verify the repository, workflow, event, run/attempt, source commit and artifact association through the GitHub API and checkout log; match the artifact-name SHA to that source. Download the selected artifact by its run and artifact ID, verify the GitHub ZIP SHA-256 digest and exact three filenames, then record each file's SHA-256 and check manifest bytes against the selected source. Install those verified files in the disposable local validation environment without rebuilding the candidate. Record this identity with the local observations, host version/platform and unavailable coverage. The local run does not require a GitHub-hosted execution workflow. PR artifacts may be inspected as pipeline evidence but are not final candidate acceptance.

Acceptance uploads need no tag or GitHub release and retain the existing `contents: read` permissions and credential-free checkout. They grant no OIDC/attestation/publishing privileges or automated continuation. The separate `numerals-<SHA>` tag artifact and reviewed prerelease publisher contract are unchanged; publication still requires the owner-only procedure below.

### Verified Actions (2026-09-13)

All workflow actions are pinned to immutable commits. The requested checkout, setup-node and attest action manifests declare `runs.using: node24`:

| Action | Verified release | Commit |
| --- | --- | --- |
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | 7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0) | 7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| [actions/attest](https://github.com/actions/attest/releases/tag/v4.2.2) | 4.2.2 | `1e69f48acb82d1966a394da916b4c1698aa569d6` |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | 7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| [actions/download-artifact](https://github.com/actions/download-artifact/releases/tag/v8.0.1) | 8.0.1 | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |

[softprops/action-gh-release 3.0.3](https://github.com/softprops/action-gh-release/releases/tag/v3.0.3) was verified as Node 24 but intentionally replaced with direct GitHub CLI/API calls after review. The tag-based action cannot bind every upload and final publication to the newly reserved release ID. The workflow instead uploads to the [release asset endpoint](https://docs.github.com/en/rest/releases/assets) and [publishes that exact draft ID](https://docs.github.com/en/rest/releases/releases#update-a-release) only after verification.

Publishing grants only contents, attestations and OIDC writes. Organization-registry storage records are disabled with `create-storage-record: false`, so no `artifact-metadata` permission is needed for this personal repository's release assets. See the [attestation action's storage-record documentation](https://github.com/actions/attest/tree/v4.2.2#artifact-metadata-storage-records).

Workflow YAML was validated with official `actionlint` 1.7.12 (download checksum verified). Parsed workflow regression checks also protect the required check sequence, read-only PR permissions, pinned actions, absence of project execution in publishing, and explicit prerelease options.

## Owner-only prerelease procedure

1. Review and merge focused PRs into `chore/recovery-1.11`. Use the next unused production-shaped version after a published candidate; never move a tag or replace assets.
2. For subsequent candidates, run `npm run version:patch` (or the explicitly intended minor/major command). The script synchronizes package, lockfile and manifest, preserves tab formatting, and leaves `versions.json` unchanged. Commit the candidate for review. `npm run version:bump` is the generic patch-default command; the old npm `version` lifecycle hook was removed to prevent `npm version` from invoking a second increment. Direct `npm version` is not the supported candidate workflow and metadata mismatch fails validation.
3. Only the owner runs `npm run release:beta` from the clean integration branch at its remote reviewed tip. It fetches recovery/master refs, verifies protected stable blobs, rejects existing local/remote tags or GitHub releases, runs `npm ci` and all checks, verifies HEAD and metadata again, and pushes one new tag without force.
4. Tag CI repeats the checks with locked dependencies, verifies the tag resolves to the checked-out reviewed commit, then packages `main.js`, the unchanged candidate `manifest.json`, and `styles.css`. No `manifest-beta.json` is used.
5. Publishing successfully lists releases (including drafts with its write token) and rejects an existing candidate. Same-tag workflow runs are serialized. After downloading and attesting validated assets, it rechecks the remote integration tip and remote tag against the validated SHA. Lightweight and annotated tags are supported, with bounded annotated-tag dereferencing; missing/moved tags or API failures abort. It reserves a **new private draft** with `draft: true`, `prerelease: true`, `make_latest: "false"`, and the validated SHA as `target_commitish`, then retains the returned numeric release ID.
6. Upload all three files by POST to that exact release ID, with no deletion, overwrite or tag-based rediscovery. Verify the draft identity/state and the exact asset set, upload state, byte sizes and SHA-256 digests. Recheck the remote tag, then publish the same ID with `draft: false`, `prerelease: true`, `make_latest: "false"`, and explicit validated `target_commitish`. Uploads precede publication, which also supports repositories with immutable published releases.

`npm run release` and `npm run release:production` unconditionally fail without writes. There is no production promotion path or environment-variable bypass. Missing/auth-failed/network-failed release queries stop publication; they never imply that a release is absent. A failed tag push leaves the local tag for owner inspection. Upload/asset-verification failures leave a private draft and never attempt publication; reruns refuse to reuse it. Use a new reviewed candidate; do not overwrite assets or promote the failed release. An ambiguous final publication response requires owner inspection of the exact recorded ID, not an automatic retry.

Stable guards protect historical `versions.json` bytes (SHA-256 `b22a24bcecf33760e5319eae5439fc2ba5041478f19d58c743f57b6dc0199e01`) and remote master's manifest/versions Git blobs (`a8f7f565d79833c333f77f4acfc3e540a8c69b14` / `51aa485d3ba838dcef42ab89206b36d4e2e07136`). Tests use disposable repositories to prove positive tag creation and negative version/tag/prerelease cases. The actual inline publication shell also runs against an offline API executable modeling immutable public releases, verifying exact-ID uploads, successful lightweight/annotated tags, refusal of missing/moved tags, and privacy on upload/verification failures. No live vault, real tag/release or stable ref is touched.

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

The following records Package B validation at its reviewed commit, not current installed acceptance. Local automated validation used macOS arm64, Node 24.12.0 and npm 11.6.2. All 536 existing Jest tests pass, as do the production/test/script typechecks, lint, symbol checks and toolchain guard tests. The repeated production build's `main.js` SHA-256 is `19f91dfc32abb7eb1dfd1128fc636de651b3c4ed1d4e972735468189376c35b7`. Generated outputs are ignored and must not be committed.

This package does not establish live Obsidian 1.13, desktop/mobile or BRAT installation behavior. No release was published, no existing tag or asset was modified, and no live-vault plugin artifact was touched. The tag publishing workflow still requires owner execution/verification after integration; unit fixtures do not prove GitHub publication or host behavior.

The ignored local environment file `.codex/environments/environment.toml` currently sets `setup.script = "npm install --package-lock=false"`. Propose changing that setup through the Codex environment editor to `npm ci`; do not commit this local configuration or run its live Obsidian reload actions. Actual Package B validation uses clean `npm ci` independently of that setup.
