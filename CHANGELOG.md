# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Changed
- Upgraded mathjs from `^11.3.3` to `^14.5.3` for latest features and security fixes
### Fixed  
- Updated `math.Unit.isValidAlpha` function call to match new single-parameter signature

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
