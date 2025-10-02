# Rendering Function Refactoring Plan

## Executive Summary

The `processAndRenderNumeralsBlockFromSource` function is a monolithic 187-line function that handles preprocessing, evaluation, and rendering. It has several code quality issues:

1. **Single Responsibility Violation**: Handles preprocessing, evaluation, DOM manipulation, and side effects (result insertion)
2. **Code Duplication**: Repeated patterns across render styles (Plain, TeX, SyntaxHighlight)
3. **Poor Separation of Concerns**: DOM manipulation mixed with business logic
4. **Side Effects**: Mutates rawRows array, modifies editor content
5. **Low Testability**: Large function difficult to test in isolation
6. **Readability Issues**: Deep nesting, unclear control flow, magic numbers

## Current Architecture Issues

### Issue 1: Monolithic Function
The function does too much:
- Preprocessing (line cleanup, directive removal)
- Scope management
- Math evaluation
- Result insertion side effects
- DOM rendering (3 different styles)
- Error rendering
- Comment handling
- Empty line handling

### Issue 2: Code Duplication in Rendering
Each render style (Plain, TeX, SyntaxHighlight) has:
- Duplicate empty line handling logic
- Duplicate comment extraction and rendering
- Similar DOM structure creation
- Repeated inputElement/resultElement creation

### Issue 3: Mutation and Side Effects
- Mutates `rawRows[i]` in place (lines 330, 334)
- Side effect: editor modification in insertion_lines block (lines 295-311)
- Makes reasoning about function behavior difficult

### Issue 4: Complex Conditional Logic
- Nested if statements for empty lines, emitters, hidden lines
- Switch statement with duplicated pre/post switch logic
- Unclear precedence of different display rules

## Target Architecture

### Design Principles
1. **Single Responsibility**: Each function does one thing
2. **Pure Functions**: No side effects where possible
3. **Data Pipeline**: Clear flow from input → processing → output
4. **Strategy Pattern**: Pluggable rendering strategies
5. **Immutability**: Avoid mutations, use transformations
6. **Testability**: Each component independently testable

### Proposed Structure

```
processAndRenderNumeralsBlockFromSource (orchestrator)
    ├── preprocessBlock (pure)
    │   ├── parseDirectives
    │   ├── applyStringReplacements
    │   └── return: ProcessedBlock
    │
    ├── buildScope (pure)
    │   ├── getScopeFromFrontmatter
    │   └── return: NumeralsScope
    │
    ├── evaluateBlock (pure)
    │   ├── evaluateMathFromSourceStrings
    │   └── return: EvaluationResult
    │
    ├── handleResultInsertions (side effect - isolated)
    │   └── modifyEditorLines
    │
    └── renderBlock (pure DOM generation)
        ├── createBlockContainer
        ├── renderLines
        │   ├── prepareLineData
        │   ├── selectRenderer (strategy)
        │   │   ├── PlainRenderer
        │   │   ├── TeXRenderer
        │   │   └── SyntaxHighlightRenderer
        │   └── renderComments
        └── renderError (if present)
```

### Key Improvements

1. **Extract Pure Functions**: Separate data transformation from side effects
2. **Renderer Strategy Pattern**: Each render style is a separate, testable class
3. **Data Transfer Objects**: Create clear data structures for each pipeline stage
4. **Isolated Side Effects**: Result insertion separated into its own function
5. **Composable Functions**: Small, focused functions that compose together

## Detailed Refactoring Steps

### Phase 1: Setup and Data Structures (Non-breaking)

#### Step 1.1: Create Data Transfer Objects
**Files**: `src/numerals.types.ts`

Create new interfaces for data pipeline:

```typescript
export interface ProcessedBlock {
    rawRows: string[];
    processedSource: string;
    blockInfo: numeralsBlockInfo;
}

export interface EvaluationResult {
    results: unknown[];
    inputs: string[];
    errorMsg: Error | null;
    errorInput: string;
}

export interface LineRenderData {
    index: number;
    rawInput: string;
    processedInput: string;
    result: unknown;
    isEmpty: boolean;
    isEmitter: boolean;
    isHidden: boolean;
    comment: string | null;
}

export interface RenderContext {
    renderStyle: NumeralsRenderStyle;
    settings: NumeralsSettings;
    numberFormat: mathjsFormat;
    preProcessors: StringReplaceMap[];
}
```

**Tests**: Add unit tests for type definitions (type checking)
**Risk**: None - additive change

---

#### Step 1.2: Create Renderer Interface
**Files**: `src/renderers/ILineRenderer.ts` (new)

```typescript
export interface ILineRenderer {
    renderLine(
        container: HTMLElement,
        lineData: LineRenderData,
        context: RenderContext
    ): void;
}
```

**Tests**: Interface definition test
**Risk**: None - additive change

---

### Phase 2: Extract Line Preparation Logic (Non-breaking)

#### Step 2.1: Extract Line Data Preparation
**Files**: `src/numeralsUtilities.ts`

Extract function:
```typescript
export function prepareLineData(
    index: number,
    rawRows: string[],
    inputs: string[],
    results: unknown[],
    blockInfo: numeralsBlockInfo,
    settings: NumeralsSettings
): LineRenderData
```

This extracts:
- Empty line detection (line 321)
- Emitter class logic (lines 323-326)
- Hidden line determination (lines 313-318)
- Comment extraction (lines 410-413)
- Directive cleanup (lines 329-334) - now returns clean string instead of mutating

**Tests**:
- Unit tests for prepareLineData with various inputs
- Test empty lines, emitters, hidden lines, comments
- Test directive cleanup

**Risk**: Low - new function, no changes to existing code

---

#### Step 2.2: Extract Comment Handling
**Files**: `src/numeralsUtilities.ts`

Extract:
```typescript
export function extractComment(rawInput: string): {
    inputWithoutComment: string;
    comment: string | null;
}

export function renderComment(
    element: HTMLElement,
    comment: string
): void
```

**Tests**:
- Test comment extraction with various patterns
- Test rendering of comments

**Risk**: Low - pure functions

---

### Phase 3: Implement Renderer Strategy Pattern (Parallel Development)

#### Step 3.1: Create Base Renderer
**Files**: `src/renderers/BaseLineRenderer.ts` (new)

Implement shared logic:
- Empty line handling
- Comment rendering
- Common DOM structure

```typescript
export abstract class BaseLineRenderer implements ILineRenderer {
    protected createLineContainer(lineData: LineRenderData): HTMLElement;
    protected renderComment(container: HTMLElement, comment: string): void;
    protected handleEmptyLine(inputEl: HTMLElement, resultEl: HTMLElement): void;

    abstract renderLine(
        container: HTMLElement,
        lineData: LineRenderData,
        context: RenderContext
    ): void;
}
```

**Tests**: Test base class shared functionality
**Risk**: Low - new code

---

#### Step 3.2: Implement Plain Renderer
**Files**: `src/renderers/PlainRenderer.ts` (new)

Extract Plain rendering logic (lines 338-356) into class:

```typescript
export class PlainRenderer extends BaseLineRenderer {
    renderLine(
        container: HTMLElement,
        lineData: LineRenderData,
        context: RenderContext
    ): void {
        // Extracted plain rendering logic
    }

    private handleSumDirective(input: string): HTMLElement;
}
```

**Tests**:
- Comprehensive tests for plain rendering
- Test sum directive highlighting
- Test empty lines, comments, results
- Snapshot tests

**Risk**: Low - parallel development

---

#### Step 3.3: Implement TeX Renderer
**Files**: `src/renderers/TeXRenderer.ts` (new)

Extract TeX rendering logic (lines 357-387):

```typescript
export class TeXRenderer extends BaseLineRenderer {
    renderLine(/* ... */): void;
    private convertInputToTeX(input: string, rawInput: string): string;
    private convertResultToTeX(result: unknown, context: RenderContext): string;
    private applyTeXTransformations(tex: string): string;
}
```

**Tests**:
- TeX conversion tests
- Currency replacement tests
- Subscript unescaping tests
- Snapshot tests

**Risk**: Medium - complex logic, but isolated

---

#### Step 3.4: Implement SyntaxHighlight Renderer
**Files**: `src/renderers/SyntaxHighlightRenderer.ts` (new)

Extract syntax highlighting logic (lines 388-406):

```typescript
export class SyntaxHighlightRenderer extends BaseLineRenderer {
    renderLine(/* ... */): void;
    private convertToHighlightedHTML(input: string, rawInput: string): DocumentFragment;
}
```

**Tests**:
- HTML conversion tests
- Sanitization tests
- Snapshot tests

**Risk**: Low - simplest renderer

---

#### Step 3.5: Create Renderer Factory
**Files**: `src/renderers/RendererFactory.ts` (new)

```typescript
export class RendererFactory {
    static createRenderer(style: NumeralsRenderStyle): ILineRenderer {
        switch (style) {
            case NumeralsRenderStyle.Plain:
                return new PlainRenderer();
            case NumeralsRenderStyle.TeX:
                return new TeXRenderer();
            case NumeralsRenderStyle.SyntaxHighlight:
                return new SyntaxHighlightRenderer();
        }
    }
}
```

**Tests**: Test factory returns correct renderer types
**Risk**: Low

---

### Phase 4: Extract Result Insertion Side Effect

#### Step 4.1: Extract Result Insertion Logic
**Files**: `src/numeralsUtilities.ts`

Extract the side effect into isolated function:

```typescript
export function handleResultInsertions(
    results: unknown[],
    insertionLines: number[],
    numberFormat: mathjsFormat,
    ctx: MarkdownPostProcessorContext,
    app: App,
    el: HTMLElement
): void {
    // Lines 295-311
    for (const i of insertionLines) {
        const sectionInfo = ctx.getSectionInfo(el);
        // ... rest of logic
    }
}
```

**Tests**:
- Mock editor interactions
- Test insertion line calculations
- Test regex replacement

**Risk**: Medium - side effect, needs careful testing

---

### Phase 5: Refactor Main Function (Breaking Changes)

#### Step 5.1: Create Block Rendering Function
**Files**: `src/numeralsUtilities.ts`

New pure function that orchestrates rendering:

```typescript
export function renderNumeralsBlock(
    container: HTMLElement,
    evaluationResult: EvaluationResult,
    processedBlock: ProcessedBlock,
    context: RenderContext
): void {
    const renderer = RendererFactory.createRenderer(context.renderStyle);

    for (let i = 0; i < evaluationResult.inputs.length; i++) {
        const lineData = prepareLineData(
            i,
            processedBlock.rawRows,
            evaluationResult.inputs,
            evaluationResult.results,
            processedBlock.blockInfo,
            context.settings
        );

        if (lineData.isHidden) {
            continue;
        }

        const lineContainer = container.createEl("div", {cls: "numerals-line"});
        if (lineData.isEmitter) {
            lineContainer.toggleClass("numerals-emitter", true);
        }

        renderer.renderLine(lineContainer, lineData, context);
    }

    if (evaluationResult.errorMsg) {
        renderError(container, evaluationResult);
    }
}

export function renderError(
    container: HTMLElement,
    evaluationResult: EvaluationResult
): void {
    // Lines 422-428 extracted
}
```

**Tests**:
- Integration tests with mocked renderer
- Test line iteration and skipping
- Test error rendering
- Snapshot tests

**Risk**: Medium - new main rendering function

---

#### Step 5.2: Refactor Main Orchestrator Function
**Files**: `src/numeralsUtilities.ts`

Refactor `processAndRenderNumeralsBlockFromSource`:

```typescript
export function processAndRenderNumeralsBlockFromSource(
    el: HTMLElement,
    source: string,
    ctx: MarkdownPostProcessorContext,
    metadata: {[key: string]: unknown} | undefined,
    type: NumeralsRenderStyle,
    settings: NumeralsSettings,
    numberFormat: mathjsFormat,
    preProcessors: StringReplaceMap[],
    app: App
): NumeralsScope {
    // Determine render style
    const blockRenderStyle = type ?? settings.defaultRenderStyle;

    // Phase 1: Preprocess
    const processedBlock = preProcessBlockForNumeralsDirectives(source, preProcessors);

    // Phase 2: Apply block styles
    applyBlockStyles({
        el,
        settings,
        blockRenderStyle,
        hasEmitters: processedBlock.blockInfo.emitter_lines.length > 0,
    });

    // Phase 3: Build scope
    const scope = getScopeFromFrontmatter(
        metadata,
        undefined,
        settings.forceProcessAllFrontmatter,
        preProcessors
    );

    // Phase 4: Evaluate
    const evaluationResult = evaluateMathFromSourceStrings(
        processedBlock.processedSource,
        scope
    );

    // Phase 5: Handle side effects (result insertions)
    handleResultInsertions(
        evaluationResult.results,
        processedBlock.blockInfo.insertion_lines,
        numberFormat,
        ctx,
        app,
        el
    );

    // Phase 6: Render
    const renderContext: RenderContext = {
        renderStyle: blockRenderStyle,
        settings,
        numberFormat,
        preProcessors,
    };

    renderNumeralsBlock(el, evaluationResult, processedBlock, renderContext);

    return scope;
}
```

**Tests**:
- Integration tests using existing test suite
- Verify all existing tests pass
- Add tests for new clear pipeline structure

**Risk**: High - major refactor, but well-tested

---

### Phase 6: Cleanup and Optimization

#### Step 6.1: Remove Array Mutations
**Files**: `src/numeralsUtilities.ts`

In `prepareLineData`, ensure we return cleaned strings rather than mutating:

```typescript
function cleanRawInput(rawInput: string, settings: NumeralsSettings): string {
    let cleaned = rawInput;

    if (settings.hideEmitterMarkupInInput) {
        cleaned = cleaned.replace(/^([^#\r\n]*?)([\t ]*=>[\t ]*)(\$\{.*\})?(.*)$/gm,"$1$4");
    }

    cleaned = cleaned.replace(/@\s*\[([^\]:]+)(::[^\]]*)?\](.*)$/gm, "$1$3");

    return cleaned;
}
```

**Tests**: Test string cleaning without mutations
**Risk**: Low

---

#### Step 6.2: Add Performance Tests
**Files**: `tests/performance.test.ts` (new)

Add performance benchmarks:
- Large blocks (100+ lines)
- Complex expressions
- Multiple render styles
- Memory usage

**Risk**: Low - observational

---

#### Step 6.3: Update Documentation
**Files**: `ARCHITECTURE.md`, code comments

Update architecture documentation with new structure:
- Update flow diagrams
- Document renderer pattern
- Update extension points

**Risk**: None

---

## Testing Strategy

### Unit Tests (New)
- `prepareLineData()` - all edge cases
- Each renderer class - comprehensive coverage
- `handleResultInsertions()` - mocked editor
- `renderNumeralsBlock()` - integration
- `cleanRawInput()` - string transformations

### Integration Tests (Existing + New)
- Full pipeline tests using existing test suite
- New snapshot tests for each renderer
- Cross-renderer consistency tests

### Regression Tests
- Run full existing test suite at each step
- All 90+ existing tests must pass
- Snapshot tests must match

### Manual Testing
- Test in real Obsidian environment
- Test all 3 render styles
- Test with complex real-world examples
- Test performance with large blocks

## Rollout Strategy

### Development Approach
1. **Feature Branch**: Create `refactor/render-pipeline` branch
2. **Incremental PRs**: Each phase is a separate PR for review
3. **Parallel Development**: Phases 1-3 can be done in parallel
4. **Feature Flags**: If needed, add flag to use old vs new rendering

### PR Sequence
1. **PR #1**: Phase 1 (Data structures) - Low risk, additive
2. **PR #2**: Phase 2 (Line preparation) - Low risk, extraction
3. **PR #3**: Phase 3.1-3.2 (Base + Plain renderer) - Parallel, new code
4. **PR #4**: Phase 3.3-3.4 (TeX + Highlight renderers) - Parallel, new code
5. **PR #5**: Phase 3.5 + Phase 4 (Factory + Side effects) - Medium risk
6. **PR #6**: Phase 5 (Main refactor) - High risk, carefully reviewed
7. **PR #7**: Phase 6 (Cleanup) - Low risk, polish

### Review Checklist for Each PR
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Test coverage >= 90%
- [ ] No breaking changes to public API
- [ ] Performance benchmarks show no regression
- [ ] Documentation updated
- [ ] Manual testing completed

## Risk Mitigation

### High-Risk Areas
1. **TeX Rendering** - Complex transformations, easy to break
   - Mitigation: Extensive snapshot tests, manual verification

2. **Result Insertion** - Side effects, editor manipulation
   - Mitigation: Mock editor thoroughly, test edge cases

3. **Main Refactor** - Large change, potential for bugs
   - Mitigation: Small incremental changes, rigorous testing

### Rollback Plan
- Each PR can be reverted independently (Phases 1-4)
- Phase 5 (main refactor) should have feature flag if possible
- Keep old function as `processAndRenderNumeralsBlockFromSource_legacy` during transition

## Success Metrics

### Code Quality
- [ ] Cyclomatic complexity < 10 per function (currently ~25)
- [ ] Function length < 50 lines (currently 187)
- [ ] Test coverage >= 90% (currently ~75%)
- [ ] No mutations of input parameters
- [ ] Clear separation of concerns

### Performance
- [ ] No performance regression (< 5% slower)
- [ ] Memory usage stable or improved
- [ ] Large blocks (100+ lines) render in < 100ms

### Maintainability
- [ ] Adding new render style requires < 100 lines of code
- [ ] Clear extension points documented
- [ ] New developer can understand architecture in < 30 minutes

## Timeline Estimate

- **Phase 1**: 2-3 days (data structures, testing)
- **Phase 2**: 3-4 days (extraction, testing)
- **Phase 3**: 5-7 days (renderers, extensive testing)
- **Phase 4**: 2-3 days (side effect isolation)
- **Phase 5**: 5-7 days (main refactor, integration)
- **Phase 6**: 2-3 days (cleanup, docs)

**Total**: 19-27 days (approximately 4-5 weeks with reviews)

## Benefits of This Approach

1. **Incremental**: Each step is reviewable and testable
2. **Low Risk**: Breaking changes isolated to final phases
3. **Parallel Work**: Phases 1-3 can be developed simultaneously
4. **Maintainable**: Clear architecture, easy to extend
5. **Testable**: Each component independently testable
6. **Readable**: Small, focused functions with clear purpose
7. **Flexible**: Easy to add new render styles or features

## Long-term Vision

This refactoring sets up the codebase for:
- Easy addition of new render styles
- Plugin system for custom renderers
- Better error handling and recovery
- Performance optimizations
- Streaming/progressive rendering for large blocks
- Better IDE support and type inference
