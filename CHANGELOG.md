# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Upload the three checked candidate files from ordinary recovery CI as a separate acceptance artifact named by the actual tested commit, without requiring a tag or publishing a release.
- Add an unpublished recovery usage guide covering source order, variable scope, metadata freshness, grouping, formatting and safe insertion. Keep the README stable guide distinct and document recovery-specific checks and release boundaries.
- Add a disposable Linux CI harness that records official Obsidian Reading callbacks and Live Preview trees for 95 byte-preserved synthetic extraction fixtures, with verified native activity from each primary note, callback origins, support-note hashes, pinned inputs and bounded cancellation.
- Add a host-independent whole-note source index, ordered evaluation service, and detached result snapshots for the recovery surface integration. Metadata seeds, reference dependencies, insertion provenance, and suggestion symbols share one captured generation.
- Per-expression TeX rendering for Inline Numerals via the new `#$:` (result only) and `#$=:` (equation) trigger prefixes, which render with MathJax in both Live Preview and Reading mode. Both prefixes are configurable in settings. (Closes #161)
- Block-level `@format` and `@decimalPlaces` directives for overriding result presentation without changing calculated values. (Closes #75, #140)
- Currency-standard decimal places by default and optional configured-symbol display for pure currency results, including derived currency values. Configured-symbol display is the default when no valid saved preference exists; saved code/symbol choices are preserved. (Closes #160)

### Changed
- Record accepted source evaluation, verified CI acceptance artifacts, default development-dependency remediation and stable/recovery documentation in the work ledger; define bounded automatic insertion and an explicit stored-result update action without changing source freshness or stable publication.
- Pin the private standalone Markdown parser to `@lezer/markdown` 1.7.2 after accepted Obsidian 1.13.7 Linux extraction validation; bundle its common/highlight dependencies while preserving host CodeMirror boundaries.
- Provide all settings through Obsidian 1.13 native searchable definitions. Currency changes use explicit Save/Cancel forms, preserve valid saved preferences, and validate complete settings with legacy migration and duplicate-trigger protection.
- Pin Obsidian 1.13.1 typings and the 0.4.2 Obsidian linter; adopt native DOM helpers and keep their owning-document behavior.
- Removed the hidden no-op `@createUnit` preprocessing stub; unsupported declarations and existing unit collisions remain visible errors.
- Recovery candidates use synchronized 1.11.0 package/lock/manifest metadata and require Obsidian 1.13.0; historical stable version mappings remain unchanged.
- Run recovery CI on Node 24 with locked installs, separate strict production/test/script typechecks, Jest, lint, symbol checks, and reproducible production builds; explicitly exclude nested worktrees.
- Restrict recovery release tooling to BRAT prereleases from the exact current reviewed integration tip, reject mismatched or reused versions and earlier ancestor commits, and disable production promotion. Verify the remote tag and all three uploaded assets before publishing the newly created draft by its exact release ID; failures leave it private. Preserve stable 1.10.2 and existing release assets.
- Update vulnerable development dependencies, including esbuild 0.28.2, without changing mathjs or runtime dependencies.
- Recorded the recovery implementation contract, work ledger, and BRAT-only publication boundary.
- Documented recovery task ownership, verified historical-work preservation, and source-ordered function/state semantics.
- Specified atomic currency runtime replacement and generation ownership to preserve symbol syntax and prevent stale mappings.
- Clarified failed-expression binding rollback while retaining native mathjs closure identity; opaque mutable closure and engine side effects remain an explicit limitation.
- Recorded reviewed input-recovery completion, phased evaluation ownership, explicit repair behavior for invalid currency mappings, accepted default-branch maintenance, and the isolated host-extraction validation gate.
- Centralized block, inline, TeX, and result-insertion formatting behind one result-formatting pipeline so evaluation always retains raw mathjs values.
- Result insertion continues to persist currency codes even when configured-symbol display is enabled.

### Fixed
- Resolve captured cross-note metadata in one private batch with actual dependency provenance, independent typed copies, and preserved raw nested-property/array semantics; avoid repeated sampling, missing-reference side effects and stale-cache authority.
- Copy declarative metadata through own data properties throughout arrays, plain objects and native Matrix/ResultSet contents, preventing provider accessors or iterators from executing during capture while preserving shared and cyclic values.
- Match accepted Obsidian fence language tokens, inline HTML boundaries and quoted content tabs in the standalone source index; normalize parser line endings while retaining original UTF-16 mappings; withhold ambiguous quoted fences with diagnostics and preserve physical source order. Record all 95 native Linux extraction cases with explicit conservative source policies.
- Read complete insertion wrappers containing matrices, nested collections, quoted brackets, and escaped quotes; preserve their exact source spans and existing serialized values when reprocessing a block.
- Give rendered blocks and Reading inline elements disposable occurrence ownership; refresh native/Dataview and missing-reference changes, initialize Source-mode subscriptions, cancel queued work on unload, and support popout Text/SVG click navigation.
- Isolate note evaluation bindings by source generation while preserving defining-block function locals and current preceding dollar globals. Commit successful rows, stop failed blocks, and detach recorded results and previous-result payloads; native closure/object and runtime side effects remain outside binding rollback.
- Keep native frontmatter authoritative over stale Dataview YAML, quarantine ambiguous projections, and bound pending metadata transitions. Independent verified results retain their own insertion eligibility.
- Retain uncertainty from advanced native runtime effects, including public `typed` registry mutations, across note generations and attach live safety epochs to insertion eligibility; a fresh runtime clears this state without source replay.
- Preserve exact normalized BigNumber currency-rate values and public Unit formatting flags when converting aliases to codes.
- Preserve currency symbols used as native object keys and dotted property names while normalizing currency values and conversion targets.
- Canonicalize currency aliases inside native mathjs ResultSets, preserving semicolon result entries and retained currency codes during insertion after a remap.
- Apply currency remaps and removal atomically using private full mathjs runtimes; failed saves keep the active configuration, and invalid saved mappings stay editable with a visible calculation error until repaired. Expose typed settings generations for cache/insertion invalidation.
- Support currency suffixes, standalone conversion symbols and native quoted unit strings without shared parser patches or global MathJax macros. Preserve delimiter commas, variable names, compound-unit serialization and retained values' originating runtime.
- Preserve grouped literals after implicit multiplication and compose insertion wrappers with previous/sum directives; keep reference display labels intact with many references and magic-variable text in note/property names.
- Preserve mathjs argument, array, and index commas while normalizing complete grouped numbers only outside delimiter contexts; protect strings and comments through currency and directive preprocessing.
- Bind cross-note properties as cloned typed values, fixing negative-value powers and preserving complex numbers, units, matrices, and precision. Reject reference assignments and cross-note function exports, retain original labels/diagnostics, and expose unresolved dependencies for refresh adapters.
- Inline TeX triggers now use MathJax's inline mode in Reading mode and Live Preview instead of rendering as centered display math.

## [1.10.2] - 2026-05-19

### Changed
- Rewrote the README to present stable inline calculations, cross-note references, and recent Numerals features without beta labeling.
- Moved the legacy source colocated Numerals test into the Jest-covered `tests/` directory.

### Removed
- Removed one-off agent planning and architecture documents, unused config stubs, and unreferenced PR screenshots from the repository.

## [1.10.1] - 2026-05-15

### Changed
- Pinned runtime dependencies, replaced the git-based CodeMirror language package with a registry package, and committed the npm lockfile for reproducible community review builds.
- Updated the release workflow to publish only Obsidian-supported release assets while preserving optional local zip packaging.

### Fixed
- Updated plugin manifest metadata to satisfy Obsidian Community Plugin review guidance.
- Replaced global DOM/timer access and newer settings button APIs with popout-compatible equivalents.
- Replaced direct `hasOwnProperty` calls with a safe helper for metadata objects.
- Cleaned stylesheet rules flagged by the Obsidian Community Plugin CSS review.

### Removed
- Removed the `builtin-modules` dev dependency in favor of Node's built-in module metadata.

## [1.10.0] - 2026-05-15

### Added
- Cross-note references: Use `[[note name]].property` syntax to reference frontmatter and Dataview metadata values from other notes in math blocks and inline expressions. Supports nested properties via dot notation (e.g. `[[config]].rates.hourly`). Auto-complete suggests available properties after typing `[[note]].`. (Closes #134)
- Setting to enable/disable cross-note references (enabled by default).

### Changed
- Merged beta-specific README content into the main README and labeled beta-only features in place.
- License changed from "All Rights Reserved" to MIT.
- Updated mathjs from `^14.5.3` to `^15.2.0` to include the April 2026 security fixes.
- Mathjs auto-complete suggestions now include newly supported functions and constants from the upgraded mathjs version.
- README features list now documents cross-note references.
- Replaced the bundled Dataview package import with a runtime Dataview API lookup, reducing the production bundle size and removing bundled Dataview transitive dependencies.
- Release flow now generates tag-matched `manifest.json` release assets for modern BRAT prereleases and promotion to Obsidian stable releases.
- Release workflow now creates signed GitHub Artifact Attestations for release assets.

### Fixed
- Release workflow no longer uses deprecated `set-output` commands or archived release upload actions. (Closes #124)
- Rendered Numerals math blocks can now be clicked or tapped in Live Preview to focus the corresponding source line for editing. (Closes #50, #59)
- Inline cross-note references now rerender when referenced note metadata changes.
- Cross-note references now evaluate dependent metadata values using the referenced note's Numerals scope.
- Tiny non-zero numbers in system and locale-formatted results no longer render as `0` or `-0`; values with more than five leading decimal zeroes now use scientific notation to avoid overly wide output. (Closes #121)
- Syntax highlighting renderer no longer displays numbers ≥100,000 in scientific notation (e.g. `226000` was shown as `2.26e+5`). (Closes #118)
- `npm run symbols:update` now fails loudly if the static mathjs symbol array cannot be found.

### Added
- `npm run symbols:check` and `npm run symbols:update` for keeping mathjs auto-complete suggestions in sync with the installed mathjs documentation metadata.
- Documented the mathjs symbol maintenance scripts in the README development workflow.
- `@prev` directive support in inline Numerals expressions — reference the result of the previous inline expression (e.g. `` `#: 100 * 1.2` `` followed by `` `#: @prev * 1.08` ``). Works in both Live Preview and Reading mode. (Closes #129)
- Note-global `$` variables in inline expressions — `$`-prefixed assignments (e.g. `` `#: $apples = 100` ``) are now shared across all math blocks and inline expressions on the same page, matching code block behavior. Auto-complete picks them up automatically.
- Auto-complete suggestions now work inside inline Numerals code spans (e.g. `` `#: `` and `` `#=: ``), providing variable names, functions, constants, and Greek letter completions — the same suggestions available in math code blocks.
- Settings tab icon (`calculator`) for upcoming Obsidian settings tab icon feature.
- `AGENTS.md` with project conventions for AI coding assistants (conventional commits, atomic commits, CHANGELOG maintenance).
- `eslint-plugin-obsidianmd` with recommended ruleset for Obsidian plugin best practices.
- `npm run lint` script.

### Changed
- Migrated ESLint from legacy `.eslintrc` to flat config (`eslint.config.mjs`, ESLint v9).
- Updated dev dependencies: tslib 2.4→2.8, esbuild 0.25→0.27, @types/node 16→22, TypeScript 5.4→5.8.
- Settings UI text converted to sentence case per Obsidian style guidelines.
- Replaced inline styles in currency settings UI with CSS classes for better theming.
- Removed redundant "Numerals Plugin Settings" heading (settings tab already shows plugin name).

### Fixed
- Resolved all 172 lint errors from `eslint-plugin-obsidianmd` (now 0 errors, 0 warnings).
- Added type safety to untyped API boundaries (loadData, Dataview, mathjs).
- Fixed floating promises in settings migration and TeX rendering.
- Removed unnecessary type assertions and unused imports.
- Fixed unbound method reference for mathjs `isAlpha`.
- Moved `ARCHITECTURE.md` to `doc/ARCHITECTURE.md` and cleaned up: removed line counts and other volatile details.

### Removed
- Removed the duplicate `BETA_README.md` in favor of a single README with beta labels.
- Removed the stale `scripts/build-release.mjs` release helper.
- Removed legacy `manifest-beta.json`; modern BRAT installs beta builds from GitHub release assets.
- Deleted the one-off `utilities/mathjs_symbol_parse.ipynb` notebook in favor of the maintained TypeScript symbol update workflow.
- Deleted `REFACTOR_REVIEW.md` and `RENDER_REFACTOR.md` (one-time planning documents, no longer needed).

## [1.9.0] - 2026-02-18
### Added
- **Inline Calculations** ([#5](https://github.com/gtg922r/obsidian-numerals/issues/5)): Evaluate math expressions directly in inline code using trigger prefixes. Works in both Live Preview and Reading mode.
  - **Result-only** mode (`` `#: expr` ``): Renders just the computed result.
  - **Equation** mode (`` `#=: expr` ``): Renders the expression, a separator, and the result.
  - Inline expressions have access to note-global variables (`$`-prefixed) and frontmatter properties.
  - Trigger prefixes and equation separator are configurable in settings.
  - Errors display the raw expression with a wavy red underline.
- New settings: *Enable Inline Numerals*, *Result-only Trigger*, *Equation Trigger*, *Equation Separator*.

### Fixed
- **Dataview phantom key errors**: Dataview's `canonicalizeVarName` creates additional keys (e.g., `f(x)` → `fx`) that caused "Undefined symbol" errors when `numerals: all` was set. These phantom keys are now automatically filtered.
- **Source mode decorations on load**: Inline numerals widgets briefly appeared in source mode before the first editor update. The Live Preview check now runs on initialization.
- **Currency changes not taking effect**: Changing currency symbol mappings in settings required a restart. Pre-processors are now resolved dynamically.
- **Editor extensions registered before formatting ready**: `numberFormat` is now initialized before editor extensions are registered, preventing potential errors on plugin load.

## [1.8.0] - 2026-02-16
### Changed
- Upgraded TypeScript from 4.7 to 5.4 with full `strict` mode enabled.
- Split `numeralsUtilities.ts` (976 lines) into 6 focused modules under `src/processing/` and `src/rendering/`.
- Renderers now share result formatting logic via `BaseLineRenderer` (DRY refactor).
- `RendererFactory` now caches renderer instances (singleton pattern).
- Architecture documentation (`ARCHITECTURE.md`) fully rewritten to reflect new structure.

### Fixed
- **Memory leak**: Event listeners were registered on the Plugin and accumulated indefinitely. Now registered on `MarkdownRenderChild` and cleaned up on navigation. Relates to [#108](https://github.com/gtg922r/obsidian-numerals/issues/108).
- **Double rendering**: Math blocks were evaluated and rendered twice per display (with/without trailing newline). Added deduplication. Relates to [#108](https://github.com/gtg922r/obsidian-numerals/issues/108).
- **Wrong editor in split panes**: Result insertions (`@[var::result]`) could write to the wrong file when multiple panes were open.
- **Silent frontmatter errors**: Errors evaluating frontmatter values were swallowed via `console.error`. Now surfaced as visible warnings in the math block.
- **Error type inconsistency**: Evaluation errors were plain objects instead of `Error` instances. Created `NumeralsError` class.
- **Settings migration bug**: `layoutStyle in [0,1,2,3]` checked array indices instead of values (dead code path). Fixed to `.includes()`.
- **Unit redefinition on re-enable**: `math.createUnit()` now wrapped in try/catch so the plugin can be disabled and re-enabled without an app restart. Relates to [#90](https://github.com/gtg922r/obsidian-numerals/issues/90).
- **Suggestor accumulation**: Toggling "Provide Suggestions" on/off registered a new suggestor each time. Now registered once on load.
- Plugin now properly cleans up `scopeCache` on unload.
- Pre-compiled TeX currency regexes (were re-created on every call).
- `getMathJsSymbols()` no longer allocates a new array on every keystroke.
- Fixed typo: `addGobals` → `addGlobals`.

## [1.7.0] - 2025-10-02
### Changed
- **Rendering pipeline refactor**: Rewrote the monolithic 187-line `processAndRenderNumeralsBlockFromSource` function into a clean 7-phase pipeline across 6 refactoring phases.
  - Phase 1: Introduced typed DTOs (`NumeralsLineData`, `NumeralsBlockData`, etc.) for data flowing through the pipeline.
  - Phase 2: Extracted 4 pure line-preparation functions.
  - Phase 3: Implemented Strategy Pattern for renderers (Plain, TeX, Syntax Highlight), replacing switch statements.
  - Phase 4: Isolated result-insertion side effect into its own module.
  - Phase 5: Composed the above into a readable 30-line orchestrator pipeline.
  - Phase 6: Verification, cleanup, and documentation.
- All rendering transformations are now pure functions.
- 70+ new tests added (148 total at the time of release), 100% backward compatibility maintained.

### Fixed
- **Result insertion crash on partial evaluation**: When evaluation aborted early (e.g., due to an error), result insertions for later lines would crash with a `TypeError`. Added guard clause to skip lines where results are missing.

## [1.6.0] - 2025-07-12
### Changed
- Upgraded mathjs from `^11.3.3` to `^14.5.3` for latest features and security fixes.
### Fixed  
- Updated `math.Unit.isValidAlpha` function call to match new single-parameter signature
- mathjs upgrade fixes [#106](https://github.com/gtg922r/obsidian-numerals/issues/106) as mathjs now handles alternate white space 

## [1.5.6] - 2025-05-31
### Added
- Added this CHANGELOG
### Fixed
- [#101](https://github.com/gtg922r/obsidian-numerals/issues/101): Global functions not working across math blocks
- [#77](https://github.com/gtg922r/obsidian-numerals/issues/77): Error description not visible in a block with result annotation
- Build scripts fixed from previous cleanup

## [1.5.5] - 2025-05-27
### Fixed
- Fix build breakage on new esbuild version.
- Tweak release scripts.

## [1.5.4] - 2025-05-27
### Changed
- Updated `esbuild` dependency to `0.25.0`.
### Fixed
- Build issues after Obsidian upgrade.

## [1.5.3] - 2025-05-26
### Changed
- Updated to latest Obsidian API and removed global `app` references.
- Show pull request links when not on `master`.

## [1.5.2] - 2025-05-26
### Added
- `@prev` magic variable to reference previous line's result.
### Changed
- Various script updates for building and releasing.

## [1.5.1] - 2024-06-16
### Added
- `@hideRows` directive to hide lines that lack a `=>` result annotation.

## [1.5.0] - 2024-06-11
### Added
- Global variables using the `$` prefix that are shared across math blocks.
- Result insertion syntax with `@[label]::result` to write results to notes.
- Support for Dataview metadata in suggestions.
### Changed
- Release workflow and lint configuration improvements.

## [1.4.1] - 2024-03-02
### Fixed
- Bug in result insertion logic.

## [1.4.0] - 2024-03-01
### Added
- `@sum` and `@total` directives for summing previous lines.
- Auto-completion for Greek characters.
### Fixed
- TeX rendering in certain locales.
