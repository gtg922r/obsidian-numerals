# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
