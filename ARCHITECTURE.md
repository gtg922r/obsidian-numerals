# Numerals Plugin Architecture

## Overview

Numerals is an Obsidian plugin that transforms `math` code blocks into interactive calculators with support for units, currency, variables, and mathematical functions. It leverages [mathjs](https://mathjs.org/) for evaluation and provides multiple rendering styles (Plain, TeX, Syntax Highlighting).

The codebase uses **TypeScript 5.4 with strict mode enabled**.

## File Structure

```
src/
├── main.ts                        # Plugin entry point and lifecycle
├── settings.ts                    # Settings UI and configuration
├── numerals.types.ts              # Type definitions, enums, NumeralsError
├── mathjsUtilities.ts             # Mathjs symbol definitions (module-level constant)
├── NumeralsSuggestor.ts           # Auto-complete functionality
├── numeralsUtilities.ts           # Barrel re-export (backwards compat)
│
├── processing/                    # Expression processing pipeline
│   ├── scope.ts                   # Frontmatter/Dataview scope resolution
│   ├── preprocessor.ts            # Directive parsing and text transforms
│   └── evaluator.ts               # Mathjs expression evaluation
│
├── rendering/                     # Output generation
│   ├── orchestrator.ts            # Block processing → DOM orchestration
│   ├── linePreparation.ts         # Line data extraction and cleaning
│   └── displayUtils.ts            # TeX currency, formatting, DOM helpers
│
└── renderers/                     # Strategy Pattern renderers
    ├── index.ts                   # Barrel exports
    ├── ILineRenderer.ts           # Renderer interface
    ├── BaseLineRenderer.ts        # Shared logic (renderFormattedResult)
    ├── PlainRenderer.ts           # Plain text rendering
    ├── TeXRenderer.ts             # TeX/MathJax rendering
    ├── SyntaxHighlightRenderer.ts # Syntax-highlighted rendering
    └── RendererFactory.ts         # Singleton-cached factory
```

### Module Responsibilities

| Module | Lines | Purpose | Key Exports |
|--------|------:|---------|-------------|
| **main.ts** | 318 | Plugin lifecycle, code block registration, currency setup | `NumeralsPlugin` |
| **settings.ts** | 401 | Settings tab UI, configuration options | `NumeralsSettingTab` |
| **numerals.types.ts** | 185 | Enums, interfaces, DTOs | `NumeralsSettings`, `NumeralsError`, `ProcessedBlock`, `EvaluationResult`, `LineRenderData`, `RenderContext` |
| **mathjsUtilities.ts** | 73 | Mathjs function/constant definitions | `getMathJsSymbols()` (reads `MATHJS_BUILT_IN_SYMBOLS` constant) |
| **NumeralsSuggestor.ts** | 238 | Editor suggestions for variables/functions | `NumeralsSuggestor` |
| **numeralsUtilities.ts** | 42 | Barrel re-export for backwards compatibility | Re-exports all public symbols from `processing/` and `rendering/` |
| **processing/scope.ts** | 203 | Frontmatter + Dataview scope building | `getScopeFromFrontmatter`, `addGlobalsFromScopeToPageCache`, `getMetadataForFileAtPath` |
| **processing/preprocessor.ts** | 99 | Directive detection and text substitution | `preProcessBlockForNumeralsDirectives`, `replaceStringsInTextFromMap` |
| **processing/evaluator.ts** | 89 | Per-line mathjs evaluation with `__prev`/`__total` | `evaluateMathFromSourceStrings` |
| **rendering/orchestrator.ts** | 323 | End-to-end block processing and DOM rendering | `processAndRenderNumeralsBlockFromSource`, `renderNumeralsBlock`, `renderError`, `handleResultInsertions`, `applyBlockStyles` |
| **rendering/linePreparation.ts** | 158 | Builds `LineRenderData` from raw evaluation results | `prepareLineData`, `extractComment`, `cleanRawInput`, `renderComment` |
| **rendering/displayUtils.ts** | 147 | TeX transforms, locale formatting, DOM helpers | `texCurrencyReplacement`, `unescapeSubscripts`, `mathjaxLoop`, `getLocaleFormatter`, `defaultCurrencyMap` |
| **renderers/\*** | 506 | Strategy Pattern renderer implementations | `ILineRenderer`, `BaseLineRenderer`, `RendererFactory`, `PlainRenderer`, `TeXRenderer`, `SyntaxHighlightRenderer` |

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       Obsidian Plugin API                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    NumeralsPlugin (main.ts)                       │
│  • Plugin lifecycle (onload / onunload)                           │
│  • Registers code block processors (math, math-tex, etc.)        │
│  • Mathjs currency setup                                         │
│  • WeakMap deduplication (prevents double rendering)              │
│  • Event listeners on MarkdownRenderChild (not Plugin)           │
│  • Scope cache cleared in onunload()                             │
└───────────┬──────────────┬───────────────┬───────────────────────┘
            │              │               │
   ┌────────┘     ┌────────┘               └──────────┐
   ▼              ▼                                   ▼
┌──────────┐ ┌──────────────┐                  ┌──────────────┐
│ Settings │ │  Suggestor   │                  │ Types/Enums  │
│  Tab     │ │              │                  │ NumeralsError│
└──────────┘ └──────────────┘                  └──────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│              rendering/orchestrator.ts                            │
│  processAndRenderNumeralsBlockFromSource()                        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 1. Determine render style                                  │  │
│  │ 2. Preprocess ──────► processing/preprocessor.ts            │  │
│  │ 3. Apply block styles                                      │  │
│  │ 4. Build scope ─────► processing/scope.ts                  │  │
│  │ 5. Evaluate ────────► processing/evaluator.ts              │  │
│  │ 6. Handle insertions (side-effect → editor)                │  │
│  │ 7. Render ──────────► renderers/ (Strategy Pattern)        │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
            │                                         │
            ▼                                         ▼
┌───────────────────────┐              ┌──────────────────────────┐
│ rendering/             │              │ renderers/               │
│  linePreparation.ts   │              │  RendererFactory         │
│  displayUtils.ts      │              │   ├─ PlainRenderer       │
│                       │              │   ├─ TeXRenderer         │
│                       │              │   └─ SyntaxHighlight...  │
└───────────────────────┘              │  BaseLineRenderer (shared│
                                       │   renderFormattedResult) │
                                       └──────────────────────────┘
```

## Processing Pipeline

Entry point: `processAndRenderNumeralsBlockFromSource()` in `rendering/orchestrator.ts`

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. PREPROCESSING (processing/preprocessor.ts)                       │
│    preProcessBlockForNumeralsDirectives()                            │
│    • Split source into lines                                         │
│    • Identify emitter lines (=>) and insertion lines (@[...])       │
│    • Replace directives (@sum/@total → __total, @prev → __prev)    │
│    • Apply currency/thousands separator replacements                │
│    • Output: rawRows[], processedSource, blockInfo                  │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. SCOPE PREPARATION (processing/scope.ts)                          │
│    getScopeFromFrontmatter()                                         │
│    • Load frontmatter variables into scope                           │
│    • Process Dataview metadata (if available)                        │
│    • Add page-global variables ($ prefix) from scopeCache           │
│    • Evaluate frontmatter expressions through mathjs                 │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. EVALUATION (processing/evaluator.ts)                             │
│    evaluateMathFromSourceStrings()                                   │
│    For each line:                                                    │
│      a. Set __prev = previous result                                 │
│      b. Calculate __total = sum since last blank line                │
│      c. Evaluate expression with mathjs                              │
│      d. Store result in scope                                        │
│      e. Handle errors (break on first error)                         │
│    Output: EvaluationResult { results[], inputs[], errorMsg }       │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. SIDE EFFECTS (rendering/orchestrator.ts)                         │
│    handleResultInsertions()                                          │
│    • Writes @[variable::result] values back to the editor           │
│    • Uses findEditorForPath() with iterateAllLeaves                 │
│    • Deferred via setTimeout(0) to avoid rendering conflicts        │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. RENDERING (rendering/ + renderers/)                              │
│    renderNumeralsBlock()                                             │
│    For each line:                                                    │
│      a. prepareLineData() → LineRenderData (pure function)          │
│      b. RendererFactory.createRenderer(style) → cached singleton    │
│      c. renderer.renderLine(container, lineData, context)           │
│    If error: renderError() appends formatted error display          │
│                                                                       │
│    Renderer styles:                                                  │
│      Plain:            Raw text input, formatted number result       │
│      TeX:              math.parse().toTex() → MathJax rendering     │
│      SyntaxHighlight:  math.parse().toHTML() → sanitized DOM        │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Module Split

The original `numeralsUtilities.ts` (976 lines) was split into 6 focused modules under `processing/` and `rendering/`. The original file remains as a **barrel re-export module** (42 lines) so existing imports are not broken.

**New code should import directly from the specific modules**, not from `numeralsUtilities.ts`.

### Strategy Pattern (Renderers)

Rendering uses the Strategy Pattern:

- **`ILineRenderer`** — interface with `renderLine(container, lineData, context)`
- **`BaseLineRenderer`** — abstract base class with shared `renderFormattedResult()`, `createElements()`, `handleEmptyLine()`, `renderInlineComment()`
- **`PlainRenderer`**, **`TeXRenderer`**, **`SyntaxHighlightRenderer`** — concrete implementations
- **`RendererFactory`** — returns singleton-cached renderer instances (renderers are stateless)

Adding a new render style requires only a new renderer class and a factory entry.

### Event Listener Lifecycle

Event listeners for metadata changes are registered on a **`MarkdownRenderChild`** scoped to each code block, not on the Plugin instance. This ensures listeners are automatically cleaned up when a block leaves the DOM.

### Double Rendering Prevention

A **`WeakMap<HTMLElement, string>`** (`renderedBlocks`) on the plugin instance tracks already-rendered containers. If a container is seen again with the same source, the handler returns early. The `WeakMap` allows garbage collection when containers are removed from the DOM.

### Plugin Cleanup

`onunload()` clears the `scopeCache` to prevent stale scope data from persisting across plugin reloads.

### Performance Optimizations

- **Pre-compiled regexes**: Currency TeX replacements (`currencyTexReplacements`) and subscript matching (`subscriptRegex`) are compiled once at module level in `displayUtils.ts`
- **Module-level constant**: `MATHJS_BUILT_IN_SYMBOLS` in `mathjsUtilities.ts` is a `readonly string[]` allocated once
- **Singleton renderers**: `RendererFactory` caches one instance per style in a `Map`
- **Scope caching**: Global variables cached per page in `scopeCache` to avoid re-evaluation
- **Suggestion caching**: Auto-complete suggestions cached with 200ms debounce
- **`findEditorForPath()`**: `handleResultInsertions` uses `iterateAllLeaves` to locate the correct editor instead of `getActiveViewOfType`, which fails in split panes

## Data Structures

Defined in `numerals.types.ts`:

| Type | Purpose |
|------|--------|
| `NumeralsError` | Custom error class for evaluation errors (`name` + `message`) |
| `ProcessedBlock` | Output of preprocessing: `rawRows`, `processedSource`, `blockInfo` |
| `EvaluationResult` | Output of evaluation: `results[]`, `inputs[]`, `errorMsg`, `errorInput` |
| `LineRenderData` | Per-line rendering data: index, raw/processed input, result, metadata flags, comment |
| `RenderContext` | Rendering configuration: style, settings, number format, preprocessors |
| `StringReplaceMap` | Pattern replacement: `regex` + `replaceStr` |
| `NumeralsScope` | Variable scope (extends `Map`) |
| `numeralsBlockInfo` | Block metadata: emitter lines, insertion lines, hidden rows, etc. |

## Variable Scoping

```
┌──────────────────────────────────────────────────────────────┐
│ Global Level (scopeCache: Map<filepath, NumeralsScope>)     │
│ • Variables prefixed with $ from frontmatter                 │
│ • Variables prefixed with $ from any math block on page     │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Block Level (scope: NumeralsScope extends Map)              │
│ • Frontmatter variables (based on 'numerals:' property)     │
│ • Variables assigned in current block                        │
│ • Magic variables: __prev, __total                           │
└──────────────────────────────────────────────────────────────┘
```

### Metadata Integration

Handled in `processing/scope.ts`:

1. **Obsidian Frontmatter**: `app.metadataCache.getFileCache()`
2. **Dataview** (optional): `getAPI().page(filepath)`
3. **Page Globals**: `scopeCache.get(filepath)`

Combined with priority: `{...frontmatter, ...dataview, ...globals}`

## Extension Points

### Adding New Render Styles

1. Add enum value to `NumeralsRenderStyle` in `numerals.types.ts`
2. Create a new renderer class extending `BaseLineRenderer` in `renderers/`
3. Register it in `RendererFactory.createRenderer()`
4. Add CSS class mapping in `numeralsRenderStyleClasses` (in `rendering/orchestrator.ts`)
5. Add styles in `styles.css`

### Adding New Directives

1. Detect in `preProcessBlockForNumeralsDirectives()` in `processing/preprocessor.ts`
2. Transform to magic variable or process directly
3. Handle magic variable in `evaluateMathFromSourceStrings()` in `processing/evaluator.ts`

### Adding Settings

1. Update `NumeralsSettings` interface in `numerals.types.ts`
2. Update `DEFAULT_SETTINGS` in `numerals.types.ts`
3. Add UI in `NumeralsSettingTab.display()` in `settings.ts`
4. Use setting in processing/rendering logic

## Key Dependencies

- **mathjs** (v14.5.3): Expression evaluation, units, currency
- **obsidian**: Plugin API, markdown processing, DOM rendering
- **obsidian-dataview** (optional): Extended metadata support
- **fast-deep-equal**: Settings comparison for reactive updates

## Testing

Test files:

| File | Coverage |
|------|----------|
| `src/numerals.test.ts` | Core evaluation and preprocessing |
| `tests/numeralsUtilities.test.ts` | Utility function tests |
| `tests/linePreparation.test.ts` | Line data extraction |
| `tests/orchestrator.test.ts` | Block orchestration |
| `tests/renderers.test.ts` | Strategy Pattern renderers |
| `tests/resultInsertion.test.ts` | Editor write-back side effects |
| `tests/types.test.ts` | DTO and type validation |

Run: `npm test` (Jest)
