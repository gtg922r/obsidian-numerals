# Obsidian Community Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate or intentionally account for every Obsidian Community Plugin dashboard auto-review warning from the May 15, 2026 review, while preserving current plugin behavior and future release reproducibility.

**Architecture:** Treat dashboard feedback as three distinct surfaces: repository metadata, source/CSS lint compliance, and release provenance. Prefer small compatibility helpers and existing Obsidian/browser APIs over raising `minAppVersion` or adding dependencies. Keep the release workflow compatible with BRAT prereleases while making official GitHub release assets limited to the three files Obsidian consumes.

**Tech Stack:** TypeScript, Obsidian API, CodeMirror 6 widgets, esbuild, npm, GitHub Actions, GitHub artifact attestations, CSS for Obsidian themes.

---

## Review Summary

The dashboard feedback falls into five groups:

1. **Manifest hygiene:** description starts with plugin name; `authorUrl` points at the plugin repo.
2. **Release hygiene:** current stable release `1.5.5` contains an extra zip asset and lacks attestations for `main.js`/`styles.css`.
3. **Source compliance:** deprecated package, global DOM/timer usage, direct `hasOwnProperty`, and Obsidian API calls newer than `minAppVersion`.
4. **CSS lint:** partial `text-decoration` support, `!important`, and duplicate selectors.
5. **Dependency reproducibility:** runtime dependencies use broad semver ranges and `package-lock.json` is ignored/uncommitted.

Important release diagnosis:

- `manifest.json` currently says `"version": "1.5.5"`.
- `package.json` currently says `"version": "1.10.0"`.
- The Obsidian dashboard release warnings are therefore almost certainly checking the **stable 1.5.5 GitHub release**, not the beta 1.10.0 prerelease.
- The stable `1.5.5` release currently has `main.js`, `manifest.json`, `styles.css`, and `numerals-1.5.5.zip`.
- Future release workflow changes are still required, because the current workflow also uploads a zip asset.

## File Map

- Modify `manifest.json`: description and author URL.
- Modify `package.json`: pin runtime dependencies, remove `builtin-modules`, keep scripts unchanged.
- Create/commit `package-lock.json`: reproducible npm build input.
- Modify `.gitignore`: stop ignoring `package-lock.json`.
- Modify `scripts/esbuild.config.mjs`: replace `builtin-modules` with Node's built-in `node:module` API.
- Create `src/utils/hasOwnProperty.ts`: shared safe own-property helper.
- Modify `src/processing/crossNoteResolver.ts`: use safe own-property helper.
- Modify `src/processing/scope.ts`: use safe own-property helper.
- Modify `src/inline/inlineLivePreview.ts`: remove global `document` usage in the CM widget.
- Modify `src/rendering/orchestrator.ts`: use the owning window for deferred editor writes.
- Modify `src/settings.ts`: remove global `document`, avoid `ButtonComponent.setDisabled` and `setTooltip`, and use the settings tab window for timers.
- Modify `styles.css`: consolidate duplicate selectors, remove `!important`, replace partial `text-decoration` usage.
- Modify `.github/workflows/release.yml`: attest and upload only Obsidian-supported assets.
- Modify `scripts/prepare-release-artifacts.mjs`: make zip creation opt-in or remove release zip generation.
- Modify `CHANGELOG.md`: add an `[Unreleased]` entry under `Fixed` or `Changed`.

## Commit Plan

Use separate commits so dashboard remediation remains reviewable:

1. `fix: address manifest review warnings`
2. `chore: make npm builds reproducible`
3. `fix: satisfy Obsidian source review rules`
4. `fix: clean Obsidian CSS lint warnings`
5. `ci: publish only supported release assets`
6. `chore: clean stable release assets`

Do not combine the GitHub release asset cleanup with source edits; it changes remote release state rather than repository files.

## Task 1: Manifest Metadata

**Files:**
- Modify: `manifest.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the plugin description and author URL**

Change `manifest.json` to avoid starting with the plugin name and to point `authorUrl` at the author profile:

```json
{
	"id": "numerals",
	"name": "Numerals",
	"version": "1.5.5",
	"minAppVersion": "0.16.0",
	"description": "Turn any code block into an advanced calculator. Evaluates math expressions on each line of a code block, including units, currency, and optional TeX rendering.",
	"author": "RyanC",
	"authorUrl": "https://github.com/gtg922r",
	"isDesktopOnly": false
}
```

Do not change `id`, `version`, or `minAppVersion` in this task.

- [ ] **Step 2: Add changelog entry**

Under `## [Unreleased]`, add:

```markdown
### Fixed
- Updated plugin manifest metadata to satisfy Obsidian Community Plugin review guidance.
```

If an `### Fixed` heading already exists under `[Unreleased]`, append the bullet there instead of creating a duplicate heading.

- [ ] **Step 3: Verify manifest JSON**

Run:

```bash
node -e "const m=require('./manifest.json'); if (m.description.startsWith(m.name)) process.exit(1); if (m.authorUrl.includes('/obsidian-numerals')) process.exit(1); console.log('manifest ok')"
```

Expected:

```text
manifest ok
```

- [ ] **Step 4: Commit**

```bash
git add manifest.json CHANGELOG.md
git commit -m "fix: address manifest review warnings"
```

## Task 2: Dependency And Build Reproducibility

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `package-lock.json`
- Modify: `scripts/esbuild.config.mjs`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Stop ignoring the npm lockfile**

Remove this line from `.gitignore`:

```gitignore
package-lock.json
```

Keep `node_modules`, `main.js`, `release/`, and `*.map` ignored.

- [ ] **Step 2: Replace `builtin-modules` with Node's built-in module list**

In `scripts/esbuild.config.mjs`, replace:

```js
import builtins from 'builtin-modules'
```

with:

```js
import { builtinModules } from "node:module";
```

Then define a de-duplicated external list after `banner`:

```js
const nodeBuiltins = [...new Set(
	builtinModules.flatMap((name) => (
		name.startsWith("node:") ? [name] : [name, `node:${name}`]
	)),
)];
```

And replace:

```js
		...builtins],
```

with:

```js
		...nodeBuiltins],
```

This removes a dev dependency and covers both `fs` and `node:fs` import forms.

- [ ] **Step 3: Pin runtime dependencies and remove `builtin-modules`**

In `package.json`, remove the `builtin-modules` dev dependency line:

```json
		"builtin-modules": "3.3.0",
```

Change runtime dependencies from ranges to exact versions:

```json
	"dependencies": {
		"fast-deep-equal": "3.1.3",
		"mathjs": "15.2.0"
	}
```

Do not change the git URL dependency for `@codemirror/language`; it is already pinned by URL rather than a semver range.

- [ ] **Step 4: Generate and commit lockfile**

Run:

```bash
npm install --package-lock-only
```

Expected:

- `package-lock.json` exists.
- `package-lock.json` root package version is `1.10.0`.
- `package-lock.json` no longer contains `node_modules/builtin-modules`.

- [ ] **Step 5: Add changelog entry**

Under `## [Unreleased]` -> `### Changed`, add:

```markdown
- Pinned runtime dependencies and committed the npm lockfile for reproducible community review builds.
```

Under `## [Unreleased]` -> `### Removed`, add:

```markdown
- Removed the `builtin-modules` dev dependency in favor of Node's built-in module metadata.
```

- [ ] **Step 6: Verify dependency state**

Run:

```bash
npm install
npm run build
npm test
node -e "const p=require('./package.json'); if (p.devDependencies['builtin-modules']) process.exit(1); if (p.dependencies.mathjs !== '15.2.0') process.exit(1); if (p.dependencies['fast-deep-equal'] !== '3.1.3') process.exit(1); console.log('dependencies ok')"
```

Expected:

```text
dependencies ok
```

and the normal build/test output succeeds.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json scripts/esbuild.config.mjs CHANGELOG.md
git commit -m "chore: make npm builds reproducible"
```

## Task 3: Obsidian Source Review Rules

**Files:**
- Create: `src/utils/hasOwnProperty.ts`
- Modify: `src/processing/crossNoteResolver.ts`
- Modify: `src/processing/scope.ts`
- Modify: `src/inline/inlineLivePreview.ts`
- Modify: `src/rendering/orchestrator.ts`
- Modify: `src/settings.ts`
- Modify: `tests/inlineLivePreview.test.ts`
- Modify: `tests/crossNoteResolver.test.ts`
- Modify: `tests/numeralsUtilities.test.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a safe own-property helper**

Create `src/utils/hasOwnProperty.ts`:

```ts
export function hasOwnProperty<T extends object>(
	value: T,
	key: PropertyKey,
): key is keyof T {
	return Object.prototype.hasOwnProperty.call(value, key);
}
```

- [ ] **Step 2: Update cross-note metadata filtering**

In `src/processing/crossNoteResolver.ts`, import the helper:

```ts
import { hasOwnProperty } from '../utils/hasOwnProperty';
```

Replace:

```ts
		if (metadata.hasOwnProperty(numeralsSetting)) {
			result[numeralsSetting] = metadata[numeralsSetting];
		}
```

with:

```ts
		if (hasOwnProperty(metadata, numeralsSetting)) {
			result[numeralsSetting] = metadata[numeralsSetting];
		}
```

Replace:

```ts
			if (metadata.hasOwnProperty(key)) {
				result[key] = metadata[key];
			}
```

with:

```ts
			if (hasOwnProperty(metadata, key)) {
				result[key] = metadata[key];
			}
```

- [ ] **Step 3: Update frontmatter scope filtering**

In `src/processing/scope.ts`, import the helper:

```ts
import { hasOwnProperty } from '../utils/hasOwnProperty';
```

Replace the six direct `frontmatter.hasOwnProperty(...)` calls with `hasOwnProperty(frontmatter, ...)`.

The first branch should become:

```ts
		if (hasOwnProperty(frontmatter, "numerals")) {
			if (frontmatter["numerals"] === "none") {
				frontmatter_process = {};
			} else if (frontmatter["numerals"] === "all") {
```

The string key branch should become:

```ts
			} else if (typeof frontmatter["numerals"] === "string") {
				if (hasOwnProperty(frontmatter, frontmatter["numerals"])) {
					frontmatter_process[frontmatter["numerals"]] = frontmatter[frontmatter["numerals"]];
				}
```

The array branch should become:

```ts
			} else if (Array.isArray(frontmatter["numerals"])) {
				for (const entry of frontmatter["numerals"] as unknown[]) {
					const key = String(entry);
					if (hasOwnProperty(frontmatter, key)) {
						frontmatter_process[key] = frontmatter[key];
					}
				}
			}
```

- [ ] **Step 4: Test objects that shadow `hasOwnProperty`**

Add this test to `tests/crossNoteResolver.test.ts` inside `describe('filterAvailableProperties', ...)`:

```ts
	it('handles metadata that shadows hasOwnProperty', () => {
		const metadata = {
			numerals: ['price'],
			price: 12,
			hasOwnProperty: false,
		};

		const result = filterAvailableProperties(metadata, false);

		expect(result).toEqual({ price: 12 });
	});
```

Add this test to `tests/numeralsUtilities.test.ts` inside `describe("numeralsUtilities: getScopeFromFrontmatter", ...)`:

```ts
	it("should process frontmatter that shadows hasOwnProperty", () => {
		frontmatter = {
			numerals: "x",
			x: "5 + 2",
			hasOwnProperty: false,
		};

		const { scope: result } = getScopeFromFrontmatter(frontmatter, scope, forceAll, stringReplaceMap, keysOnly);

		expect(result.get("x")).toEqual(7);
	});
```

- [ ] **Step 5: Remove global `document` from the inline CM widget**

In `src/inline/inlineLivePreview.ts`, import `activeDocument`:

```ts
import { App, EventRef, activeDocument } from 'obsidian';
```

Change `toDOM()` to accept the CodeMirror view and use the owning document:

```ts
	toDOM(view?: EditorView): HTMLElement {
		const doc = view?.dom.ownerDocument ?? activeDocument;
		const span = doc.createElement('span');
```

Replace every `document.createElement(...)` inside `toDOM` with `doc.createElement(...)`.

This keeps tests simple while making popout behavior correct for real editor views.

- [ ] **Step 6: Update inline widget tests for owner document behavior**

In `tests/inlineLivePreview.test.ts`, add:

```ts
		it('creates DOM nodes from the editor owner document when available', () => {
			const ownerDocument = document.implementation.createHTMLDocument('popout');
			const host = ownerDocument.createElement('div');
			const widget = new InlineNumeralsWidget(
				'5',
				InlineNumeralsMode.ResultOnly,
				'2+3',
				' = ',
				false,
			);

			const el = widget.toDOM({ dom: host } as EditorView);

			expect(el.ownerDocument).toBe(ownerDocument);
			expect(el.textContent).toBe('5');
		});
```

- [ ] **Step 7: Replace settings `document.createDocumentFragment()`**

In `src/settings.ts`, replace:

```ts
		const resultAnnotationMarkupDesc = document.createDocumentFragment();
```

with:

```ts
		const resultAnnotationMarkupDesc = containerEl.ownerDocument.createDocumentFragment();
```

- [ ] **Step 8: Avoid `ButtonComponent.setDisabled` and `setTooltip`**

Add these helpers near the top of `src/settings.ts` after imports:

```ts
function setButtonDisabled(button: ButtonComponent, disabled: boolean): void {
	button.buttonEl.disabled = disabled;
}

function setButtonTooltip(button: ButtonComponent, tooltip: string): void {
	button.buttonEl.setAttribute('aria-label', tooltip);
	button.buttonEl.setAttribute('title', tooltip);
}
```

Replace every `currencySaveButton.setDisabled(false)` with:

```ts
setButtonDisabled(currencySaveButton, false);
```

Replace every `currencySaveButton.setDisabled(true)` with:

```ts
setButtonDisabled(currencySaveButton, true);
```

Replace the button construction:

```ts
					.addButton(button => { button
						.setButtonText('Save')
						.setDisabled(true)
						.setTooltip('Save custom currency mapping')
```

with:

```ts
					.addButton(button => {
						button.setButtonText('Save');
						setButtonDisabled(button, true);
						setButtonTooltip(button, 'Save custom currency mapping');
						button
```

Replace `button.setDisabled(true)` in the click handler with:

```ts
setButtonDisabled(button, true);
```

Do not raise `minAppVersion`; this preserves compatibility by using the native button element.

- [ ] **Step 9: Replace unqualified timers with owner-window timers**

In `src/rendering/orchestrator.ts`, replace:

```ts
			setTimeout(() => {
				targetEditor.setLine(curLine, modifiedSource);
			}, 0);
```

with:

```ts
			const ownerWindow = el.ownerDocument.defaultView ?? window;
			ownerWindow.setTimeout(() => {
				targetEditor.setLine(curLine, modifiedSource);
			}, 0);
```

In `src/settings.ts`, before the save button click handler uses a delayed reset, add:

```ts
								const ownerWindow = containerEl.ownerDocument.defaultView ?? window;
```

Then replace:

```ts
								setTimeout(() => {
									button.setButtonText('Save');
								}, 1000);
```

with:

```ts
								ownerWindow.setTimeout(() => {
									button.setButtonText('Save');
								}, 1000);
```

- [ ] **Step 10: Add changelog entry**

Under `[Unreleased]` -> `### Fixed`, add:

```markdown
- Replaced global DOM/timer access and newer settings button APIs with popout-compatible equivalents.
- Replaced direct `hasOwnProperty` calls with a safe helper for metadata objects.
```

- [ ] **Step 11: Verify source warnings are gone**

Run:

```bash
rg -n "\\bdocument\\.create|[^.]\\bsetTimeout\\(|\\.hasOwnProperty\\(|\\.setDisabled\\(|\\.setTooltip\\(" src
npm test -- tests/crossNoteResolver.test.ts tests/numeralsUtilities.test.ts tests/inlineLivePreview.test.ts
npm run lint
npm run build
```

Expected:

- `rg` prints no source-code matches for the warned patterns.
- Targeted tests pass.
- Lint and build pass.

- [ ] **Step 12: Commit**

```bash
git add src tests CHANGELOG.md
git commit -m "fix: satisfy Obsidian source review rules"
```

## Task 4: CSS Lint Cleanup

**Files:**
- Modify: `styles.css`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Merge duplicate parenthesis selectors**

Replace the two duplicate blocks:

```css
.numerals-block .numerals-input .math-parenthesis,
 .numerals-block .numerals-input .math-paranthesis {
    padding-left: 0px;
    padding-right: 0px;
}
```

and:

```css
.numerals-block .numerals-input .math-parenthesis,
 .numerals-block .numerals-input .math-paranthesis {
    color: var(--code-punctuation);
    padding-left: 0px;
    padding-right: 0px;
}
```

with one block:

```css
.numerals-block .numerals-input .math-parenthesis,
.numerals-block .numerals-input .math-paranthesis {
    color: var(--code-punctuation);
    padding-left: 0;
    padding-right: 0;
}
```

Keep `.math-paranthesis` for compatibility with the current misspelled generated class.

- [ ] **Step 2: Remove `!important` from MathJax styles**

Replace:

```css
.numerals-block .MathJax {
    text-align: left !important;
    margin-top: .5em !important;
    margin-bottom: .5em !important;
}
```

with:

```css
.markdown-rendered .numerals-block .MathJax,
.markdown-source-view .numerals-block .MathJax {
    text-align: left;
    margin-top: 0.5em;
    margin-bottom: 0.5em;
}
```

If manual Obsidian testing shows MathJax inline styles still win, do not reintroduce `!important`; instead increase specificity with the actual rendered container selector observed in DevTools.

- [ ] **Step 3: Merge duplicate two-pane line selectors**

Replace:

```css
.numerals-panes .numerals-line {
    line-height: var(--line-height-tight);
 
}

.numerals-panes .numerals-line {
    display: flex;
 }
```

with:

```css
.numerals-panes .numerals-line {
    display: flex;
    line-height: var(--line-height-tight);
}
```

- [ ] **Step 4: Fix duplicate answer-right selector in inline section**

The second `.numerals-answer-right .numerals-line` appears under the inline style section. Replace it with:

```css
.numerals-answer-inline .numerals-line {
    line-height: var(--line-height-tight);
}
```

This removes the duplicate selector and aligns the selector with the section's layout class.

- [ ] **Step 5: Replace partially supported `text-decoration` error styling**

Replace:

```css
.numerals-inline-error {
    color: var(--text-error);
    text-decoration: underline;
    text-decoration-style: wavy;
    text-decoration-color: var(--text-error);
    text-underline-offset: 3px;
}
```

with:

```css
.numerals-inline-error {
    color: var(--text-error);
    border-bottom: 1px dotted var(--text-error);
}
```

This keeps a visible error affordance without relying on partially supported text-decoration subproperties.

- [ ] **Step 6: Add changelog entry**

Under `[Unreleased]` -> `### Fixed`, add:

```markdown
- Cleaned stylesheet rules flagged by the Obsidian Community Plugin CSS review.
```

- [ ] **Step 7: Verify CSS patterns**

Run:

```bash
rg -n "!important|text-decoration|^\\.numerals-panes \\.numerals-line|^\\.numerals-answer-right \\.numerals-line|math-parenthesis" styles.css
```

Expected:

- No `!important` matches.
- No `text-decoration` matches.
- Exactly one `.numerals-panes .numerals-line` rule.
- Exactly one `.numerals-answer-right .numerals-line` rule.
- Exactly one combined `.math-parenthesis` / `.math-paranthesis` rule.

Then manually verify in Obsidian:

- MathJax blocks remain left-aligned with reasonable vertical spacing.
- Two-pane, answer-right, answer-below, and inline layouts still render correctly.
- Inline error expressions remain visibly marked.

- [ ] **Step 8: Commit**

```bash
git add styles.css CHANGELOG.md
git commit -m "fix: clean Obsidian CSS lint warnings"
```

## Task 5: Release Asset And Attestation Workflow

**Files:**
- Modify: `scripts/prepare-release-artifacts.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Make release zip creation opt-in**

In `scripts/prepare-release-artifacts.mjs`, add:

```js
const includeZip = process.env.INCLUDE_RELEASE_ZIP === "true";
```

Replace the unconditional zip creation:

```js
execFileSync("zip", ["-r", `${pluginName}-${version}.zip`, pluginName], {
	cwd: releaseRoot,
	stdio: "inherit",
});
```

with:

```js
if (includeZip) {
	execFileSync("zip", ["-r", `${pluginName}-${version}.zip`, pluginName], {
		cwd: releaseRoot,
		stdio: "inherit",
	});
}
```

Change the final log line to:

```js
console.log(`Prepared release artifacts for ${pluginName} ${version}.`);
if (includeZip) {
	console.log(`Prepared optional zip artifact: ${pluginName}-${version}.zip.`);
}
```

Default behavior must produce only:

- `release/numerals/main.js`
- `release/numerals/manifest.json`
- `release/numerals/styles.css`

- [ ] **Step 2: Upload and attest only Obsidian-supported assets**

In `.github/workflows/release.yml`, replace the attestation `subject-path` block:

```yaml
          subject-path: |
            release/${{ env.PLUGIN_NAME }}-${{ github.ref_name }}.zip
            release/${{ env.PLUGIN_NAME }}/main.js
            release/${{ env.PLUGIN_NAME }}/manifest.json
            release/${{ env.PLUGIN_NAME }}/styles.css
```

with:

```yaml
          subject-path: |
            release/${{ env.PLUGIN_NAME }}/main.js
            release/${{ env.PLUGIN_NAME }}/manifest.json
            release/${{ env.PLUGIN_NAME }}/styles.css
```

Replace the release `files` block:

```yaml
          files: |
            release/${{ env.PLUGIN_NAME }}-${{ github.ref_name }}.zip
            release/${{ env.PLUGIN_NAME }}/main.js
            release/${{ env.PLUGIN_NAME }}/manifest.json
            release/${{ env.PLUGIN_NAME }}/styles.css
```

with:

```yaml
          files: |
            release/${{ env.PLUGIN_NAME }}/main.js
            release/${{ env.PLUGIN_NAME }}/manifest.json
            release/${{ env.PLUGIN_NAME }}/styles.css
```

- [ ] **Step 3: Verify local artifact preparation**

Run:

```bash
npm run build
node scripts/prepare-release-artifacts.mjs 1.10.0
find release -maxdepth 2 -type f | sort
```

Expected:

```text
release/numerals/main.js
release/numerals/manifest.json
release/numerals/styles.css
```

Run the opt-in path:

```bash
INCLUDE_RELEASE_ZIP=true node scripts/prepare-release-artifacts.mjs 1.10.0
find release -maxdepth 2 -type f | sort
```

Expected includes:

```text
release/numerals-1.10.0.zip
release/numerals/main.js
release/numerals/manifest.json
release/numerals/styles.css
```

- [ ] **Step 4: Add changelog entry**

Under `[Unreleased]` -> `### Changed`, add:

```markdown
- Updated the release workflow to publish only Obsidian-supported release assets while still allowing optional local zip packaging.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-release-artifacts.mjs .github/workflows/release.yml CHANGELOG.md
git commit -m "ci: publish only supported release assets"
```

## Task 6: Stable Release Asset Cleanup

**Files:**
- No repository file changes.
- Remote GitHub release state changes for tag `1.5.5`.

This task addresses the current dashboard warning:

```text
The release contains additional files: numerals-1.5.5.zip.
```

- [ ] **Step 1: Confirm current stable release assets**

Run:

```bash
gh release view 1.5.5 --json assets --jq '.assets[].name'
```

Expected before cleanup:

```text
main.js
manifest.json
numerals-1.5.5.zip
styles.css
```

- [ ] **Step 2: Delete only the unsupported zip asset**

Run:

```bash
gh release delete-asset 1.5.5 numerals-1.5.5.zip --yes
```

Do not delete `main.js`, `manifest.json`, or `styles.css`.

- [ ] **Step 3: Verify stable release assets**

Run:

```bash
gh release view 1.5.5 --json assets --jq '.assets[].name'
```

Expected after cleanup:

```text
main.js
manifest.json
styles.css
```

- [ ] **Step 4: Document remote-only cleanup**

Create a no-code commit only if repository policy requires an audit trail. If needed, add this bullet under `[Unreleased]` -> `### Fixed`:

```markdown
- Removed the unsupported zip asset from the current stable GitHub release.
```

Commit:

```bash
git add CHANGELOG.md
git commit -m "chore: document stable release asset cleanup"
```

If the changelog should only describe repository changes, skip this commit and record the cleanup in the issue/PR notes instead.

## Task 7: Attestation Strategy For Dashboard Cleanliness

**Files:**
- Usually no additional repository file changes beyond Task 5.
- Optional future stable release metadata changes: `manifest.json`, `versions.json`, `package.json`.

The dashboard recommendation says `main.js` and `styles.css` on the checked release do not have GitHub artifact attestations. Because `manifest.json` points at `1.5.5`, this is probably about old stable assets published before the attestation workflow existed.

Do **not** create misleading attestations for old assets by downloading and re-attesting them outside the original build. That would prove a later workflow handled the files, not that the files were built from source at tag `1.5.5`.

- [ ] **Step 1: Verify beta attestation availability**

After Task 5 is merged and a new beta tag is created, verify each supported asset:

```bash
gh attestation verify https://github.com/gtg922r/obsidian-numerals/releases/download/1.10.0/main.js --repo gtg922r/obsidian-numerals
gh attestation verify https://github.com/gtg922r/obsidian-numerals/releases/download/1.10.0/manifest.json --repo gtg922r/obsidian-numerals
gh attestation verify https://github.com/gtg922r/obsidian-numerals/releases/download/1.10.0/styles.css --repo gtg922r/obsidian-numerals
```

Expected:

- Each command reports a valid attestation.
- The workflow identity is `.github/workflows/release.yml`.
- The source repository is `gtg922r/obsidian-numerals`.

- [ ] **Step 2: Prefer resolving stable attestation warnings with the next stable release**

When ready to promote `1.10.0` to stable, use the production release script after Tasks 1-5 are merged:

```bash
npm run release:production
```

Then confirm `manifest.json` and `versions.json` point to `1.10.0`, and verify release assets:

```bash
gh release view 1.10.0 --json isPrerelease,assets --jq '{isPrerelease, assets: [.assets[].name]}'
gh attestation verify https://github.com/gtg922r/obsidian-numerals/releases/download/1.10.0/main.js --repo gtg922r/obsidian-numerals
gh attestation verify https://github.com/gtg922r/obsidian-numerals/releases/download/1.10.0/styles.css --repo gtg922r/obsidian-numerals
```

Expected:

```json
{"isPrerelease":false,"assets":["main.js","manifest.json","styles.css"]}
```

If the release still contains `numerals-1.10.0.zip` from the earlier beta, delete that asset before re-running the Obsidian dashboard review:

```bash
gh release delete-asset 1.10.0 numerals-1.10.0.zip --yes
```

- [ ] **Step 3: Track the old stable attestation recommendation as non-actionable unless republishing stable**

If the dashboard is re-run before promoting a new stable release, expect the `1.5.5` attestation recommendations to remain. Record this in the PR:

```markdown
The attestation recommendation applies to the existing stable 1.5.5 assets, which were published before release attestations were enabled. The workflow now attests future `main.js`, `manifest.json`, and `styles.css` assets; the recommendation will clear when the next stable release is published from the updated workflow.
```

## Task 8: Final Verification

**Files:**
- No new files unless verification uncovers issues.

- [ ] **Step 1: Run repository checks**

Run:

```bash
npm install
npm test
npm run lint
npm run build
npm run symbols:check
```

Expected:

- All tests pass.
- ESLint passes with no warnings.
- Production build produces `main.js`.
- Symbol check passes.

- [ ] **Step 2: Run dashboard-pattern searches**

Run:

```bash
rg -n "\\bdocument\\.create|[^.]\\bsetTimeout\\(|\\.hasOwnProperty\\(|\\.setDisabled\\(|\\.setTooltip\\(" src
rg -n "!important|text-decoration" styles.css
rg -n "\"builtin-modules\"|\"fast-deep-equal\": \"\\^|\"mathjs\": \"\\^" package.json package-lock.json
git check-ignore package-lock.json
```

Expected:

- First three `rg` commands print no offending matches.
- `git check-ignore package-lock.json` exits non-zero, confirming the lockfile is no longer ignored.

- [ ] **Step 3: Verify release artifact shape locally**

Run:

```bash
rm -rf release main.js
npm run build
node scripts/prepare-release-artifacts.mjs 1.10.0
find release -maxdepth 2 -type f | sort
```

Expected:

```text
release/numerals/main.js
release/numerals/manifest.json
release/numerals/styles.css
```

- [ ] **Step 4: Run Obsidian manual smoke test**

In the live vault:

1. Enable Numerals.
2. Open a note with a rendered Numerals code block in Live Preview.
3. Click a rendered result line and confirm the source line receives focus.
4. Evaluate an inline expression with an error and confirm the error remains visible.
5. Open settings and verify custom currency validation still enables/disables the save button correctly.
6. Verify the save button still resets from checkmark back to `Save`.
7. Open a popout window and repeat inline expression rendering plus settings display if possible.

- [ ] **Step 5: Re-run Obsidian Community Plugin dashboard review**

Expected after Tasks 1-6 but before next stable release:

- Manifest warnings clear.
- Source-code warnings clear.
- CSS warnings clear.
- Dependency and lockfile recommendations clear.
- Extra stable release zip warning clears after deleting `numerals-1.5.5.zip`.
- Old stable attestation recommendations may remain until a stable release is published from the updated workflow.

Expected after the next stable release is published from the updated workflow:

- Release asset list contains only `main.js`, `manifest.json`, and `styles.css`.
- `main.js` and `styles.css` have valid GitHub artifact attestations.

- [ ] **Step 6: Final commit status**

Run:

```bash
git status --short --branch
```

Expected:

```text
## <branch-name>
```

with no modified or untracked files, except intentionally ignored build artifacts like `main.js` and `release/`.

## Open Decisions

1. **Stable attestation timing:** Decide whether to promote `1.10.0` to stable soon after these fixes, or accept that the dashboard will keep warning about old `1.5.5` attestations until the next stable release.
2. **Zip assets:** The plan keeps zip packaging opt-in for local/manual workflows but removes zip uploads from GitHub releases. If BRAT testing confirms zips are unnecessary, the optional zip path can be deleted entirely in a later cleanup.
3. **`minAppVersion`:** The plan preserves `0.16.0` by avoiding newer `ButtonComponent` APIs. If a later audit finds other APIs that truly require a newer Obsidian version, raise `minAppVersion` in a dedicated compatibility PR instead of bundling it into this review cleanup.

## Self-Review

- Every dashboard comment has a corresponding task:
  - Manifest description and author URL: Task 1.
  - Missing attestations: Tasks 5 and 7.
  - Extra release zip: Tasks 5 and 6.
  - `builtin-modules`: Task 2.
  - `activeDocument`/global document: Task 3.
  - `hasOwnProperty`: Task 3.
  - `window.setTimeout`: Task 3.
  - `setDisabled`/`setTooltip` with low `minAppVersion`: Task 3.
  - CSS lint: Task 4.
  - Broad dependency ranges and missing lockfile: Task 2.
- No implementation step relies on unspecified helper names; helper signatures are defined before use.
- Release warnings are split between current stable remote cleanup and future workflow changes, because they have different causes and verification paths.
