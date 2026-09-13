# Obsidian community plugin

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.
- Plugin ID: `numerals`
- Uses mathjs library for all calculations

## Environment & tooling

- Node.js: use Node 24 as selected by `.nvmrc`.
- **Package manager: npm** (`package.json` defines npm scripts and dependencies).
- **Bundler: esbuild** (`scripts/esbuild.config.mjs` handles bundling).
- Types: `obsidian` type definitions.
- Linting: `eslint-plugin-obsidianmd` (flat config in `eslint.config.mjs`)

### Install

```bash
npm ci
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

## File & folder conventions

- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle.
- `src/settings.ts` — Settings interface, defaults, and settings tab
- `src/processing/` — Math evaluation pipeline (preprocessor, evaluator, scope)
- `src/rendering/` — Display logic (orchestrator, line preparation, display utils)
- `src/renderers/` — Render strategy implementations (TeX, Plain, SyntaxHighlight)
- `src/inline/` — Inline math evaluation support
- `tests/` — Jest test files
- `scripts/` — Build and release scripts
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files.

## Manifest rules (`manifest.json`)

- Must include: `id`, `name`, `version`, `minAppVersion`, `description`, `isDesktopOnly`
- Never change `id` after release.
- Keep `minAppVersion` accurate when using newer APIs.

## Git workflow

### Commits

- **Atomic commits**: Each commit should represent one logical change. Do not mix unrelated changes in a single commit.
- **Conventional commit messages**: Use the [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat:` — New feature
  - `fix:` — Bug fix
  - `chore:` — Maintenance, tooling, dependencies
  - `refactor:` — Code restructuring without behavior change
  - `docs:` — Documentation only
  - `test:` — Adding or updating tests
  - `style:` — Formatting, whitespace (not CSS)
- Include a blank line after the subject, then a body explaining *why* if the change is non-obvious.

### CHANGELOG

- **Always update `CHANGELOG.md`** when making user-visible or developer-visible changes.
- Add entries under the `[Unreleased]` section at the top.
- Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format with categories: Added, Changed, Fixed, Removed.
- CHANGELOG updates should be included in the same commit as the change they describe.

### Branches & PRs

- Work on feature/fix branches, not directly on `master`.
- Branch naming: `feat/description`, `fix/description`, `chore/description`, `refactor/description`.
- Keep PRs focused. One logical effort per PR.

## Versioning & releases

- This is stable maintenance: keep `package.json`, `package-lock.json`, `manifest.json`, `versions.json` and plugin source unchanged from stable 1.10.2. Do not run version-bump commands here.
- The tag workflow and beta/production release entrypoints unconditionally refuse publication. Do not re-enable them or add bypass flags.
- Only the owner may publish BRAT prereleases from the reviewed `chore/recovery-1.11` checkout using that branch's accepted guards. Never promote stable, move existing tags or replace published assets.
- Do not copy these branch-specific publication-denial files into the recovery branch or weaken its publisher.
- Do not reintroduce `manifest-beta.json`; modern BRAT uses GitHub release assets.

## Security, privacy, and compliance

- Default to local/offline operation.
- No hidden telemetry.
- Never execute remote code.
- Register and clean up all DOM, app, and interval listeners using `register*` helpers.

## Coding conventions

- TypeScript with strict mode.
- Keep `main.ts` minimal — lifecycle only.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Prefer `async/await` over promise chains.
- Use Obsidian's `register*` helpers for cleanup.

## Agent do/don't

**Do**
- Make atomic commits with conventional commit messages.
- Update `CHANGELOG.md` in the same commit as the change.
- Add commands with stable IDs.
- Provide defaults and validation in settings.
- Write idempotent code so reload/unload doesn't leak listeners.
- Use `this.register*` helpers for everything that needs cleanup.
- Run `npm test` after changes to verify nothing is broken.
- Run `npm run build` to verify compilation succeeds.

**Don't**
- Commit multiple unrelated changes together.
- Forget to update the CHANGELOG.
- Introduce network calls without obvious user-facing reason.
- Ship features requiring cloud services without disclosure.
- Store or transmit vault contents.
- Change the plugin `id` in `manifest.json`.
