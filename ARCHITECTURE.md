# Numerals Plugin Architecture

## Overview

Numerals is an Obsidian plugin that transforms `math` code blocks into interactive calculators with support for units, currency, variables, and mathematical functions. It leverages [mathjs](https://mathjs.org/) for evaluation and provides multiple rendering styles (Plain, TeX, Syntax Highlighting).

## File Structure

```
src/
├── main.ts                   # Plugin entry point and orchestration
├── settings.ts               # Settings UI and configuration
├── numeralsUtilities.ts      # Core processing and rendering logic
├── mathjsUtilities.ts        # Mathjs symbol definitions
├── NumeralsSuggestor.ts      # Auto-complete functionality
└── numerals.types.ts         # Type definitions and enums
```

### File Responsibilities

| File | Purpose | Key Exports |
|------|---------|-------------|
| **main.ts** | Plugin lifecycle, code block registration, currency setup | `NumeralsPlugin` |
| **settings.ts** | Settings tab UI, configuration options | `NumeralsSettingTab`, currency code mappings |
| **numeralsUtilities.ts** | Block processing, evaluation, rendering | `processAndRenderNumeralsBlockFromSource`, `evaluateMathFromSourceStrings` |
| **mathjsUtilities.ts** | Mathjs function/constant definitions | `getMathJsSymbols()` |
| **NumeralsSuggestor.ts** | Editor suggestions for variables/functions | `NumeralsSuggestor` |
| **numerals.types.ts** | Type definitions, enums, interfaces | `NumeralsSettings`, `NumeralsScope`, enums |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Obsidian Plugin API                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       NumeralsPlugin (main.ts)                   │
│  • Plugin lifecycle (onload)                                     │
│  • Registers code block processors (math, math-tex, etc.)       │
│  • Mathjs currency setup                                         │
│  • Settings management                                           │
│  • Scope cache (global variables across blocks)                 │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ├──────────────────┬─────────────────┬─────────────┐
                ▼                  ▼                 ▼             ▼
      ┌─────────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────────┐
      │  Settings Tab   │ │  Suggestor    │ │  Utilities   │ │ Types/Enums  │
      │ (settings.ts)   │ │(NumeralsSug.) │ │(numeralsUt.) │ │(numerals.t.) │
      └─────────────────┘ └───────────────┘ └──────┬───────┘ └──────────────┘
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                            ┌──────────────┐ ┌────────────┐ ┌──────────────┐
                            │ Preprocessor │ │ Evaluator  │ │   Renderer   │
                            │  Directives  │ │   Mathjs   │ │ Plain/TeX/   │
                            │   Currency   │ │   Scope    │ │  Highlight   │
                            └──────────────┘ └────────────┘ └──────────────┘
                                                    │
                                                    ▼
                                          ┌──────────────────┐
                                          │  DOM Rendering   │
                                          │  Obsidian API    │
                                          └──────────────────┘
```

## Major Components

### 1. **Plugin Core** ([main.ts:88-317](main.ts))

**Entry point**: `NumeralsPlugin.onload()`

- Registers markdown code block processors for `math`, `Math`, `math-plain`, `math-tex`, `math-highlight`
- Configures mathjs with custom currency units and symbols
- Manages scope cache for global variables (`$variable`)
- Handles metadata change listeners for reactive updates

**Key method**: `numeralsMathBlockHandler()` - callback for all code block processors

### 2. **Settings Management** ([settings.ts:85-401](settings.ts))

Provides UI for configuring:
- Layout styles (2-panes, answer right/below/inline)
- Render styles (plain, TeX, syntax highlighting)
- Number formatting (locale, fixed, exponential, etc.)
- Currency symbol mappings
- Auto-complete behavior
- Frontmatter integration

### 3. **Core Processing Pipeline** ([numeralsUtilities.ts:245-432](numeralsUtilities.ts))

Main entry: `processAndRenderNumeralsBlockFromSource()`

```
Input Source
     ↓
preProcessBlockForNumeralsDirectives()
     ↓
getScopeFromFrontmatter()
     ↓
evaluateMathFromSourceStrings()
     ↓
Render Each Line (Plain/TeX/Highlight)
     ↓
DOM Output
```

### 4. **Auto-complete Suggestions** ([NumeralsSuggestor.ts:58-238](NumeralsSuggestor.ts))

Extends `EditorSuggest` to provide:
- Variable suggestions from current block
- Mathjs functions/constants (if enabled)
- Greek letter auto-complete (`:alpha` → `α`)
- Numerals directives (`@sum`, `@prev`, etc.)

### 5. **Type System** ([numerals.types.ts](numerals.types.ts))

Defines enums and interfaces:
- `NumeralsLayout`: Visual layout options
- `NumeralsRenderStyle`: Plain/TeX/Highlight
- `NumeralsNumberFormat`: Number formatting options
- `NumeralsSettings`: Plugin configuration
- `NumeralsScope`: Variable scope (extends Map)

## Main Rendering Function Flow

### Entry Point: `processAndRenderNumeralsBlockFromSource()` ([numeralsUtilities.ts:245-432](numeralsUtilities.ts))

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. PREPROCESSING (preProcessBlockForNumeralsDirectives)             │
│    • Split source into lines                                         │
│    • Identify emitter lines (=>) and insertion lines (@[...])       │
│    • Replace directives (@sum/@total/@prev with magic variables)    │
│    • Remove markup (=>, @[...])                                     │
│    • Apply currency/thousands separator replacements                │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. SCOPE PREPARATION (getScopeFromFrontmatter)                      │
│    • Load frontmatter variables into scope                           │
│    • Process Dataview metadata (if available)                        │
│    • Add page-global variables ($ prefix)                            │
│    • Evaluate frontmatter expressions through mathjs                 │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. EVALUATION (evaluateMathFromSourceStrings)                       │
│    For each line:                                                    │
│      a. Set __prev to previous result                                │
│      b. Calculate __total (sum since last blank line)                │
│      c. Evaluate expression with mathjs                              │
│      d. Store result and input                                       │
│      e. Handle errors (break on first error)                         │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. RENDERING (for each line)                                         │
│    • Create DOM element for line                                     │
│    • Apply CSS classes based on settings                             │
│    • Render based on style:                                          │
│                                                                       │
│      Plain (NumeralsRenderStyle.Plain):                             │
│      ├─ Input: raw text                                              │
│      └─ Result: formatted number string                              │
│                                                                       │
│      TeX (NumeralsRenderStyle.TeX):                                 │
│      ├─ Input: math.parse(input).toTex() → MathJax                  │
│      └─ Result: math.parse(result).toTex() → MathJax                │
│                                                                       │
│      Syntax Highlight (NumeralsRenderStyle.SyntaxHighlight):        │
│      ├─ Input: math.parse(input).toHTML() (sanitized)               │
│      └─ Result: formatted number string                              │
│                                                                       │
│    • Add inline comments                                             │
│    • Handle empty lines                                              │
│    • Apply emitter highlighting (=> annotations)                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Processing Functions

#### `preProcessBlockForNumeralsDirectives()` ([numeralsUtilities.ts:632-705](numeralsUtilities.ts))

**Input**: Raw source string
**Output**: Processed source ready for mathjs, block metadata

Steps:
1. Split into lines
2. Identify special lines (emitters `=>`, insertions `@[...]`, hidden `@hideRows`)
3. Replace Numerals directives:
   - `@sum`/`@total` → `__total`
   - `@prev` → `__prev`
   - `@[var::result]` → `var`
4. Apply preprocessors (currency symbols, thousands separators)

#### `evaluateMathFromSourceStrings()` ([numeralsUtilities.ts:725-792](numeralsUtilities.ts))

**Input**: Processed source, scope
**Output**: Results array, inputs array, error info

Processing loop:
```typescript
for each row:
  1. Set __prev = previous result
  2. Calculate __total = sum(results since last undefined)
  3. Evaluate: math.evaluate(row, scope)
  4. Store result in scope for next iteration
  5. Catch errors and break
```

#### Rendering by Style

**Plain** ([numeralsUtilities.ts:338-356](numeralsUtilities.ts)):
- Direct text rendering
- Special handling for `@sum`/`@total` with CSS class
- Format result with `math.format(result, numberFormat)`

**TeX** ([numeralsUtilities.ts:357-387](numeralsUtilities.ts)):
- Convert to TeX: `math.parse(input).toTex()`
- Apply transformations: currency replacement, subscript unescaping
- Render with MathJax: `renderMath()` + `finishRenderMath()`

**Syntax Highlight** ([numeralsUtilities.ts:388-406](numeralsUtilities.ts)):
- Convert to HTML: `math.parse(input).toHTML()`
- Sanitize with `sanitizeHTMLToDom()`
- Append DOM fragments

## Data Flow

### Variable Scoping

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

1. **Obsidian Frontmatter**: `app.metadataCache.getFileCache()`
2. **Dataview** (optional): `getAPI().page(filepath)`
3. **Page Globals**: `scopeCache.get(filepath)`

Combined with priority: `{...frontmatter, ...dataview, ...globals}`

## Extension Points

### Adding New Render Styles

1. Add enum value to `NumeralsRenderStyle` in [numerals.types.ts](numerals.types.ts)
2. Add case in rendering switch in [numeralsUtilities.ts:337-407](numeralsUtilities.ts)
3. Add CSS class mapping in `numeralsRenderStyleClasses`
4. Add styles in [styles.css](styles.css)

### Adding New Directives

1. Detect in `preProcessBlockForNumeralsDirectives()` [numeralsUtilities.ts:632-705](numeralsUtilities.ts)
2. Transform to magic variable or process directly
3. Handle magic variable in `evaluateMathFromSourceStrings()` [numeralsUtilities.ts:725-792](numeralsUtilities.ts)

### Adding Settings

1. Update `NumeralsSettings` interface in [numerals.types.ts](numerals.types.ts)
2. Update `DEFAULT_SETTINGS` in [numerals.types.ts](numerals.types.ts)
3. Add UI in `NumeralsSettingTab.display()` in [settings.ts](settings.ts)
4. Use setting in processing/rendering logic

## Key Dependencies

- **mathjs** (v14.5.3): Expression evaluation, units, currency
- **obsidian**: Plugin API, markdown processing, DOM rendering
- **obsidian-dataview** (optional): Extended metadata support
- **fast-deep-equal**: Settings comparison for reactive updates

## Performance Considerations

- **Scope caching**: Global variables cached at page level to avoid re-evaluation
- **Suggestion caching**: Auto-complete suggestions cached with 200ms debounce
- **Metadata watching**: Reactive re-rendering on metadata changes (Dataview or standard)
- **Lazy rendering**: Only processes visible code blocks via Obsidian's post-processor API

## Testing

- Unit tests in [src/numerals.test.ts](src/numerals.test.ts) and [tests/numeralsUtilities.test.ts](tests/numeralsUtilities.test.ts)
- Test framework: Jest
- Run: `npm test`
