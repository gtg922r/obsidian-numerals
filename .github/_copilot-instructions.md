# Numerals Plugin - AI Coding Guide

## Project Overview
Numerals is an Obsidian plugin that transforms `math` code blocks into interactive calculators supporting units, currency, variables, and mathematical functions. Built on **mathjs** v14.5.3 with multi-style rendering (Plain, TeX, Syntax Highlight).

## Architecture Essentials

### Core Processing Pipeline (7 Phases)
Located in `src/numeralsUtilities.ts::processAndRenderNumeralsBlockFromSource()`:

1. **Determine render style** - Resolve block-level vs default style
2. **Preprocess** - Extract directives (`@sum`, `@prev`, `@[var]`), apply currency/thousands replacements
3. **Apply block styles** - Set CSS classes on container
4. **Build scope** - Load frontmatter variables, page globals (via `$` prefix)
5. **Evaluate** - Calculate results using mathjs with magic variables (`__prev`, `__total`)
6. **Handle side effects** - Write `@[variable::result]` back to editor (isolated, async)
7. **Render** - Display using Strategy Pattern renderers

**Key Rule**: Phases 1-5 are pure functions. Phase 6 is isolated side effect. Phase 7 is DOM generation.

### Variable Scoping System
```
Global Level: scopeCache (Map<filepath, NumeralsScope>)
  └─ Variables with $ prefix from frontmatter or math blocks
Block Level: NumeralsScope (extends Map)
  └─ Frontmatter vars (controlled by 'numerals:' property)
  └─ Local assignments within block
  └─ Magic: __prev (previous result), __total (sum since last blank)
```

Access frontmatter: `numerals: all` or `numerals: [prop1, prop2]` in YAML.

### Renderer Strategy Pattern (`src/renderers/`)
- **ILineRenderer** - Interface with `renderLine(container, lineData, context)`
- **BaseLineRenderer** - Shared functionality (empty lines, comments, element creation)
- **PlainRenderer** - Text output, special handling for `@sum/@total` with CSS highlighting
- **TeXRenderer** - MathJax rendering via `math.parse().toTex()`, currency/subscript transformations
- **SyntaxHighlightRenderer** - HTML syntax coloring via `math.parse().toHTML()`
- **RendererFactory** - Creates renderers based on `NumeralsRenderStyle` enum

**To add new style**: Create renderer extending `BaseLineRenderer`, add enum to `NumeralsRenderStyle`, update factory.

### Key Data Types (`src/numerals.types.ts`)
- **ProcessedBlock** - Preprocessing output (rawRows, processedSource, blockInfo)
- **EvaluationResult** - Evaluation output (results[], inputs[], errorMsg)
- **LineRenderData** - Single line rendering data (rawInput, result, metadata, comment)
- **RenderContext** - Rendering config (renderStyle, settings, numberFormat, preProcessors)
- **StringReplaceMap** - Pattern replacements (regex, replaceStr)

## Development Workflows

### Build & Test
```powershell
npm run dev          # Watch mode with sourcemaps (esbuild)
npm run build        # Production build (minified, no sourcemaps)
npm test             # Run Jest tests (jsdom environment)
npm run release:beta # Increment version, tag, build beta release
```

Build config: `scripts/esbuild.config.mjs` - bundles `src/main.ts` → `main.js`, externalizes Obsidian API.

### Testing Strategy
- Test directory: `tests/` with Jest (148 tests)
- Key test files: `orchestrator.test.ts`, `renderers.test.ts`, `linePreparation.test.ts`, `resultInsertion.test.ts`
- **Philosophy**: Test pure functions individually, orchestrator for integration
- Mock `obsidian` module: `__mocks__/obsidian.ts`

### Plugin Installation (Symlink for Development)
```powershell
New-Item -ItemType SymbolicLink `
  -Path "path/to/vault/.obsidian/plugins/numerals" `
  -Target "C:\Projects\Obsidian\Reference\numerals"
```
Requires: `main.js`, `manifest.json`, `styles.css` in target directory.

## Coding Conventions

### Pure Functions & Immutability
**CRITICAL**: All preprocessing, evaluation, and rendering functions are pure. Never mutate arrays or objects.

**Good**:
```typescript
const cleaned = rawRows.map(row => cleanRawInput(row, settings));
```

**Bad**:
```typescript
rawRows[i] = cleanRawInput(rawRows[i], settings); // MUTATION!
```

### Side Effects Isolation
Result insertion (`@[var::value]`) is the ONLY side effect, isolated in `handleResultInsertions()` with `setTimeout(0)` for async execution.

### Preprocessor System
Currency symbols and thousands separators replaced via `StringReplaceMap[]`:
```typescript
preProcessors: [
  { regex: /\$/g, replaceStr: 'USD' },
  { regex: /,(\d{3})/g, replaceStr: '$1' }
]
```
Applied in `preProcessBlockForNumeralsDirectives()` via `replaceStringsInTextFromMap()`.

### Mathjs Integration Quirks
- **Currency handling**: Modified `math.parse.isAlpha` and `math.Unit.isValidAlpha` in `src/main.ts` to accept currency symbols
- **Custom units**: Added via `math.createUnit()` in `NumeralsPlugin.onload()`
- **Functions in frontmatter**: Parse syntax `$f(x): x+2` in `getScopeFromFrontmatter()`

## Critical Extension Points

### Adding Numerals Directives
1. **Detect** in `preProcessBlockForNumeralsDirectives()` - regex match on raw input
2. **Transform** to magic variable or markup - e.g., `@sum` → `__total`
3. **Handle** in `evaluateMathFromSourceStrings()` - calculate magic variable per line
4. **Display** in renderer if needed (e.g., `PlainRenderer` highlights `@sum`)

Example: `@prev` directive replaces with `__prev`, which is set to previous result before each evaluation.

### Settings Management
1. Add property to `NumeralsSettings` interface in `numerals.types.ts`
2. Update `DEFAULT_SETTINGS` constant
3. Create UI in `NumeralsSettingTab.display()` (`settings.ts`)
4. Access via `plugin.settings.yourProperty` in processing logic

### Live Preview (Inline Math)
File: `src/inlineMathLivePreview.ts`
- **Pattern**: `` `mathexpr: expression` ``
- **Implementation**: CodeMirror 6 ViewPlugin with `InlineMathWidget` decoration
- **Scope access**: Reads from `scopeCache` for page-global variables
- **Cursor handling**: Detects cursor position to avoid decoration flicker

## Known Gotchas

1. **Obsidian API externals**: Never bundle `obsidian`, `@codemirror/*`, `electron` - see `esbuild.config.mjs`
2. **MathJax async**: Use `renderMath()` then `finishRenderMath()` for TeX rendering
3. **Dataview optional**: Check `getAPI()` !== undefined before use
4. **Metadata cache**: Listen to `app.metadataCache.on('changed')` for reactive updates
5. **Code block priority**: Inline expressions use `sortOrder=200` to process AFTER math blocks (priority 100)
6. **Subscripts in TeX**: Escape underscores, then unescape in `unescapeSubscripts()` before rendering

## File Organization Reference
```
src/
├── main.ts                      # Plugin entry, currency setup, cache management
├── numeralsUtilities.ts         # Core pipeline (preprocessing, evaluation, rendering)
├── settings.ts                  # UI settings tab, currency mappings
├── NumeralsSuggestor.ts         # Auto-complete (EditorSuggest)
├── inlineMathLivePreview.ts     # Live Preview inline math (CM6 ViewPlugin)
├── mathjsUtilities.ts           # Mathjs symbol definitions
├── numerals.types.ts            # Type definitions, enums
└── renderers/                   # Strategy pattern implementations
    ├── ILineRenderer.ts         # Interface
    ├── BaseLineRenderer.ts      # Shared logic
    ├── PlainRenderer.ts
    ├── TeXRenderer.ts
    ├── SyntaxHighlightRenderer.ts
    └── RendererFactory.ts
```

## Recent Refactoring Context
Completed 6-phase refactoring (see `RENDER_REFACTOR.md`):
- Eliminated 187-line monolith into composable functions
- Removed all array mutations
- Introduced Strategy Pattern for renderers
- Added comprehensive DTOs (ProcessedBlock, EvaluationResult, LineRenderData)
- Isolated side effects
- 70+ new tests added (148 total)

**When extending**: Follow established patterns - pure functions, strategy pattern, clear separation of concerns.
