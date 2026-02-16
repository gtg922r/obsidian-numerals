import * as math from 'mathjs';
import { App, MarkdownPostProcessorContext, MarkdownRenderChild, EventRef } from 'obsidian';
import { getAPI } from 'obsidian-dataview';
import { NumeralsSettings, NumeralsScope, mathjsFormat, StringReplaceMap, InlineNumeralsMode } from '../numerals.types';
import { getMetadataForFileAtPath, getScopeFromFrontmatter } from '../processing/scope';
import { parseInlineExpression } from './inlineParser';
import { evaluateInlineExpression } from './inlineEvaluator';

/**
 * Render an inline numerals result into a container element.
 *
 * Replaces the content of the given element with the evaluated result.
 * In Equation mode, shows "input = result". In ResultOnly mode, shows just the result.
 *
 * @param codeEl - The <code> element to render into
 * @param expression - The raw expression text (trigger already stripped)
 * @param mode - Whether to show result-only or equation style
 * @param result - The formatted result string
 * @param settings - Plugin settings (for separator string)
 */
function renderInlineResult(
	codeEl: HTMLElement,
	expression: string,
	mode: InlineNumeralsMode,
	result: string,
	settings: NumeralsSettings
): void {
	codeEl.empty();
	codeEl.addClass('numerals-inline');

	if (mode === InlineNumeralsMode.Equation) {
		codeEl.addClass('numerals-inline-equation');
		codeEl.createEl('span', { cls: 'numerals-inline-input', text: expression });
		codeEl.createEl('span', { cls: 'numerals-inline-separator', text: settings.inlineEquationSeparator });
		codeEl.createEl('span', { cls: 'numerals-inline-value', text: result });
	} else {
		codeEl.addClass('numerals-inline-result');
		codeEl.createEl('span', { cls: 'numerals-inline-value', text: result });
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
 * Process a single <code> element for inline Numerals.
 *
 * @param codeEl - The inline <code> element
 * @param scope - The variable scope to evaluate against
 * @param settings - Plugin settings
 * @param numberFormat - Number formatting options
 * @param preProcessors - String replacement preprocessors
 */
function processInlineCodeElement(
	codeEl: HTMLElement,
	scope: NumeralsScope,
	settings: NumeralsSettings,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[]
): void {
	const text = codeEl.innerText;

	const parsed = parseInlineExpression(
		text,
		settings.inlineResultTrigger,
		settings.inlineEquationTrigger
	);

	if (!parsed) return;

	try {
		const result = evaluateInlineExpression(
			parsed.expression,
			scope,
			numberFormat,
			preProcessors
		);
		renderInlineResult(codeEl, parsed.expression, parsed.mode, result, settings);
	} catch {
		renderInlineError(codeEl, parsed.expression);
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
 * @param preProcessors - Preprocessing rules (currency, thousands, etc.)
 * @param scopeCache - Shared scope cache for note-global variables
 * @returns The post-processor function (for registration with Plugin.registerMarkdownPostProcessor)
 */
export function createInlineNumeralsPostProcessor(
	app: App,
	getSettings: () => NumeralsSettings,
	getNumberFormat: () => mathjsFormat,
	preProcessors: StringReplaceMap[],
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
			code.innerText.startsWith(resultTrigger) ||
			code.innerText.startsWith(equationTrigger)
		);
		if (!hasMatch) return;

		// Build scope from frontmatter + note-global cache
		const metadata = getMetadataForFileAtPath(ctx.sourcePath, app, scopeCache);
		const { scope } = getScopeFromFrontmatter(
			metadata,
			undefined,
			settings.forceProcessAllFrontmatter,
			preProcessors
		);

		// Merge note-global scope from cache
		const pageScope = scopeCache.get(ctx.sourcePath);
		if (pageScope) {
			for (const [key, value] of pageScope.entries()) {
				scope.set(key, value);
			}
		}

		const numberFormat = getNumberFormat();

		// Process each code element
		for (const codeEl of Array.from(codeElements)) {
			processInlineCodeElement(codeEl, scope, settings, numberFormat, preProcessors);
		}
	};
}
