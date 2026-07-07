import { App, MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { NumeralsSettings, NumeralsScope, mathjsFormat, StringReplaceMap } from '../numerals.types';
import { getMetadataForFileAtPath, getScopeFromFrontmatter } from '../processing/scope';
import { hasInlineTrigger, parseInlineExpression } from './inlineParser';
import { evaluateInlineExpression } from './inlineEvaluator';
import { getDataviewApi } from '../dataview';
import { renderInlineResultContent } from './inlineRenderer';

/**
 * Write `$`-prefixed globals to the shared scope cache.
 * This makes inline-defined globals visible to subsequent code blocks
 * and inline expressions in later sections.
 */
function addGlobalsToScopeCache(
	scopeCache: Map<string, NumeralsScope>,
	sourcePath: string,
	globals: Map<string, unknown>
): void {
	let pageScope = scopeCache.get(sourcePath);
	if (!pageScope) {
		pageScope = new NumeralsScope();
		scopeCache.set(sourcePath, pageScope);
	}
	for (const [key, value] of globals) {
		pageScope.set(key, value);
	}
}

/**
 * Render an error state for an inline expression.
 *
 * Shows the original expression in an error style so the user can see
 * what they typed and fix it.
 *
 * @param codeEl - The <code> element to render the error into
 * @param expression - The raw expression that failed
 */
function renderInlineError(
	codeEl: HTMLElement,
	expression: string
): void {
	codeEl.empty();
	codeEl.addClass('numerals-inline', 'numerals-inline-error');
	codeEl.createEl('span', { text: expression });
}

/**
 * Mutable reference to the previous inline evaluation result.
 * Used to thread `@prev` values through sequential inline expression processing.
 */
interface PrevResultRef {
	value: unknown;
}

interface InlineProcessingResult {
	referencedPaths: string[];
}

/**
 * Process a single <code> element for inline Numerals.
 *
 * After evaluation, any `$`-prefixed variable assignments are:
 * 1. Written to the `scopeCache` for cross-section/cross-block visibility
 * 2. Injected into the shared `scope` for same-section inline→inline visibility
 *
 * @param codeEl - The inline <code> element
 * @param scope - The variable scope to evaluate against (also updated with globals)
 * @param settings - Plugin settings
 * @param numberFormat - Number formatting options
 * @param preProcessors - String replacement preprocessors
 * @param prevResultRef - Mutable ref tracking the previous inline result (for @prev support)
 * @param scopeCache - Shared scope cache for note-global variables
 * @param sourcePath - File path for scopeCache keying
 */
function processInlineCodeElement(
	codeEl: HTMLElement,
	scope: NumeralsScope,
	settings: NumeralsSettings,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[],
	prevResultRef: PrevResultRef,
	scopeCache: Map<string, NumeralsScope>,
	sourcePath: string,
	app: App
): InlineProcessingResult {
	const text = codeEl.dataset.numeralsInlineSource ?? codeEl.innerText;

	const parsed = parseInlineExpression(
		text,
		settings.inlineResultTrigger,
		settings.inlineEquationTrigger
	);

	if (!parsed) return { referencedPaths: [] };

	codeEl.dataset.numeralsInlineSource = text;

	try {
		const result = evaluateInlineExpression(
			parsed.expression,
			scope,
			numberFormat,
			preProcessors,
			prevResultRef.value,
			app,
			sourcePath,
			settings,
		);
		prevResultRef.value = result.raw;

		// Propagate $-prefixed globals for note-wide visibility
		if (result.globals.size > 0) {
			for (const [key, value] of result.globals) {
				// Update shared scope for same-section inline→inline visibility
				scope.set(key, value);
			}
			// Write to scopeCache for cross-section/cross-block visibility
			addGlobalsToScopeCache(scopeCache, sourcePath, result.globals);
		}

		codeEl.empty();
		renderInlineResultContent(
			codeEl,
			parsed.mode,
			parsed.renderStyle,
			parsed.expression,
			result.processedExpression,
			result.formatted,
			result.raw,
			settings.inlineEquationSeparator,
			preProcessors,
		);
		return { referencedPaths: result.referencedPaths };
	} catch {
		prevResultRef.value = undefined;
		renderInlineError(codeEl, parsed.expression);
		return { referencedPaths: [] };
	}
}

/**
 * Creates and registers a Markdown post-processor for inline Numerals.
 *
 * The post-processor scans every rendered element for <code> elements
 * that start with a recognized trigger prefix. Matching elements are
 * evaluated and replaced with rendered results.
 *
 * This follows the same pattern as Dataview's inline queries:
 * - Works in both Live Preview and Reading mode
 * - Works on mobile
 * - Post-processors only fire on render, not on scroll
 *
 * @param app - The Obsidian App instance
 * @param settings - Plugin settings (read at call time for hot-reload)
 * @param numberFormat - Number formatting configuration
 * @param getPreProcessors - Returns current preprocessing rules (currency, thousands, etc.)
 * @param scopeCache - Shared scope cache for note-global variables
 * @returns The post-processor function (for registration with Plugin.registerMarkdownPostProcessor)
 */
export function createInlineNumeralsPostProcessor(
	app: App,
	getSettings: () => NumeralsSettings,
	getNumberFormat: () => mathjsFormat,
	getPreProcessors: () => StringReplaceMap[],
	scopeCache: Map<string, NumeralsScope>
): (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		const settings = getSettings();
		if (!settings.enableInlineNumerals) return;

		const codeElements = el.querySelectorAll<HTMLElement>('code');
		if (codeElements.length === 0) return;

		// Quick-reject: check if any code element starts with a trigger
		// before building scope (which is the expensive part)
		const resultTrigger = settings.inlineResultTrigger;
		const equationTrigger = settings.inlineEquationTrigger;
		const hasMatch = Array.from(codeElements).some(code =>
			hasInlineTrigger(code.innerText, resultTrigger, equationTrigger)
		);
		if (!hasMatch) return;

		const inlineCodeElements = Array.from(codeElements);

		const renderInlineElements = (): string[] => {
			// Build scope from frontmatter + note-global cache.
			// getMetadataForFileAtPath already merges scopeCache entries
			// into the metadata, so no separate merge step is needed.
			const currentSettings = getSettings();
			const preProcessors = getPreProcessors();
			const metadata = getMetadataForFileAtPath(ctx.sourcePath, app, scopeCache);
			const { scope } = getScopeFromFrontmatter(
				metadata,
				undefined,
				currentSettings.forceProcessAllFrontmatter,
				preProcessors
			);

			const numberFormat = getNumberFormat();

			// Track previous result for @prev support.
			// Resets per section (post-processor call), so @prev only chains
			// within the same rendered section.
			const prevResultRef: PrevResultRef = { value: undefined };
			const referencedPaths = new Set<string>();

			// Process each code element in DOM order (which matches source order)
			for (const codeEl of inlineCodeElements) {
				const result = processInlineCodeElement(
					codeEl,
					scope,
					currentSettings,
					numberFormat,
					preProcessors,
					prevResultRef,
					scopeCache,
					ctx.sourcePath,
					app
				);
				for (const path of result.referencedPaths) {
					referencedPaths.add(path);
				}
			}

			return Array.from(referencedPaths);
		};

		let referencedPaths = renderInlineElements();
		if (referencedPaths.length === 0) return;

		const inlineChild = new MarkdownRenderChild(el);
		const rerenderIfReferencedFileChanged = (_callbackType: unknown, file: unknown) => {
			const changedPath = (file && typeof file === 'object' && 'path' in file)
				? (file as { path: string }).path
				: undefined;

			if (!changedPath || !referencedPaths.includes(changedPath)) {
				return;
			}

			referencedPaths = renderInlineElements();
		};

		const dataviewAPI = getDataviewApi(app);
		if (dataviewAPI) {
			const ref = app.metadataCache.on(
				// @ts-expect-error: dataview custom event not in Obsidian types
				"dataview:metadata-change",
				rerenderIfReferencedFileChanged
			);
			inlineChild.registerEvent(ref);
		} else {
			const ref = app.metadataCache.on("changed", rerenderIfReferencedFileChanged);
			inlineChild.registerEvent(ref);
		}

		ctx.addChild(inlineChild);
	};
}
