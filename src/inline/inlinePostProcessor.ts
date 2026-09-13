import { ReferenceEvaluationError, ReferenceDependency, parseCrossNoteReferences } from '../processing/crossNoteResolver';
import { App, MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { NumeralsSettings, NumeralsScope, StringReplaceMap, InlineNumeralsMode, InlineEvaluationResult, NumeralsRenderStyle } from '../numerals.types';
import type { FormattedResult, ResultFormatter } from '../formatting';
import { getMetadataForFileAtPath, getScopeFromFrontmatter } from '../processing/scope';
import { getInlineTriggers, parseInlineExpression } from './inlineParser';
import { evaluateInlineExpression } from './inlineEvaluator';
import { affectsOccurrence, HostEventHub, HostEventSource } from '../host/events';
import { renderInlineInputContent, renderInlineValueContent } from './inlineRenderer';

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
 * Render an Inline Numerals result into a container element.
 *
 * Replaces the content of the given element with the evaluated result.
 * In Equation mode, shows "input = result". In ResultOnly mode, shows just the result.
 *
 * @param codeEl - The <code> element to render into
 * @param expression - The raw expression text (trigger already stripped)
 * @param mode - Whether to show result-only or equation style
 * @param renderStyle - Whether to render as plain text or TeX (from the matched trigger)
 * @param result - The formatted result string
 * @param settings - Plugin settings (for separator string)
 */
function renderInlineResult(
	codeEl: HTMLElement,
	expression: string,
	mode: InlineNumeralsMode,
	renderStyle: NumeralsRenderStyle,
	result: InlineEvaluationResult,
	formattedResult: FormattedResult,
	settings: NumeralsSettings,
): void {
	codeEl.empty();
	codeEl.addClass('numerals-inline');

	// TeX-rendered spans strip the code chrome so they read as native inline math
	if (renderStyle === NumeralsRenderStyle.TeX) {
		codeEl.addClass('numerals-inline-tex');
	}

	if (mode === InlineNumeralsMode.Equation) {
		codeEl.addClass('numerals-inline-equation');
		const inputEl = codeEl.createSpan({ cls: 'numerals-inline-input' });
		renderInlineInputContent(
			inputEl,
			expression,
			result.processedExpression,
			renderStyle
		);
		codeEl.createSpan({ cls: 'numerals-inline-separator', text: settings.inlineEquationSeparator });
		const valueEl = codeEl.createSpan({ cls: 'numerals-inline-value' });
		renderInlineValueContent(
			valueEl,
			formattedResult,
			renderStyle
		);
	} else {
		codeEl.addClass('numerals-inline-result');
		const valueEl = codeEl.createSpan({ cls: 'numerals-inline-value' });
		renderInlineValueContent(
			valueEl,
			formattedResult,
			renderStyle
		);
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
	codeEl.createSpan({ text: expression });
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
	dependencies: ReferenceDependency[];
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
 * @param formatter - Shared result formatter
 * @param preProcessors - String replacement preprocessors
 * @param prevResultRef - Mutable ref tracking the previous inline result (for @prev support)
 * @param scopeCache - Shared scope cache for note-global variables
 * @param sourcePath - File path for scopeCache keying
 */
function processInlineCodeElement(
	codeEl: HTMLElement,
	text: string,
	scope: NumeralsScope,
	settings: NumeralsSettings,
	formatter: ResultFormatter,
	preProcessors: StringReplaceMap[],
	prevResultRef: PrevResultRef,
	scopeCache: Map<string, NumeralsScope>,
	sourcePath: string,
	app: App
): InlineProcessingResult {
	const parsed = parseInlineExpression(text, getInlineTriggers(settings));

	if (!parsed) return { referencedPaths: [], dependencies: [] };

	codeEl.dataset.numeralsInlineSource = text;

	try {
		const result = evaluateInlineExpression(
			parsed.expression,
			scope,
			preProcessors,
			prevResultRef.value,
			app,
			sourcePath,
			settings,
		);
		const formattedResult = formatter.format(result.raw);
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

		renderInlineResult(
			codeEl,
			parsed.expression,
			parsed.mode,
			parsed.renderStyle,
			result,
			formattedResult,
			settings
		);
		return { referencedPaths: result.referencedPaths, dependencies: result.dependencies };
	} catch (error: unknown) {
		prevResultRef.value = undefined;
		renderInlineError(codeEl, parsed.expression);
		codeEl.title = error instanceof Error ? error.message : 'Unable to evaluate this calculation.';
		return { referencedPaths: error instanceof ReferenceEvaluationError ? error.referencedPaths : [],
			dependencies: error instanceof ReferenceEvaluationError ? error.dependencies :
				parseCrossNoteReferences(parsed.expression).map(reference => ({ ...reference, sourcePath, status: 'missing-note' as const })),
		};
	}
}


const inlineClasses = ['numerals-inline', 'numerals-inline-tex', 'numerals-inline-equation', 'numerals-inline-result', 'numerals-inline-error'];

/** Each code element retains its original source and releases its section on host unload. */
class InlineOccurrence extends MarkdownRenderChild {
	source: string;
	readonly originalTitle: string;
	readonly ownershipPath: string;
	dependencies: InlineProcessingResult = { referencedPaths: [], dependencies: [] };
	disposed = false;
	private renderedNodes: Node[] | undefined;

	constructor(readonly code: HTMLElement, readonly context: MarkdownPostProcessorContext,
		readonly refresh: () => void, private readonly released: () => void) {
		super(code);
		this.source = code.dataset.numeralsInlineSource ?? code.innerText ?? code.textContent ?? '';
		this.originalTitle = code.title;
		this.ownershipPath = context.sourcePath;
	}

	private ownsPresentation(): boolean {
		return this.renderedNodes !== undefined && this.renderedNodes.length === this.code.childNodes.length &&
			this.renderedNodes.every((node, index) => node === this.code.childNodes[index]);
	}

	/** External DOM replacement is new source; our own transformed DOM is not. */
	reconcileSource(): boolean {
		if (this.ownsPresentation()) return false;
		const text = this.code.innerText ?? this.code.textContent ?? '';
		const changed = this.renderedNodes !== undefined || text !== this.source;
		if (this.renderedNodes) this.clearOwnership();
		this.source = text;
		return changed;
	}

	markRendered(): void {
		this.renderedNodes = Array.from(this.code.childNodes);
		this.code.dataset.numeralsInlineSource = this.source;
	}

	private clearOwnership(): void {
		this.renderedNodes = undefined;
		this.code.classList.remove(...inlineClasses);
		this.code.title = this.originalTitle;
		delete this.code.dataset.numeralsInlineSource;
	}

	restore(): void {
		if (!this.renderedNodes) return;
		if (this.ownsPresentation()) this.code.textContent = this.source;
		this.clearOwnership();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.restore();
		this.released();
	}

	onunload(): void { this.dispose(); }
}

export interface InlinePostProcessor {
	(el: HTMLElement, ctx: MarkdownPostProcessorContext): void;
	dispose(): void;
}

/** Reading occurrences subscribe even while disabled or waiting for missing references. */
export function createInlineNumeralsPostProcessor(
	app: App, getSettings: () => NumeralsSettings, getFormatter: () => ResultFormatter,
	getPreProcessors: () => StringReplaceMap[], scopeCache: Map<string, NumeralsScope>,
	hostEvents?: HostEventSource,
): InlinePostProcessor {
	const ownedEvents = hostEvents ? undefined : new HostEventHub(app);
	const events = hostEvents ?? ownedEvents!;
	const occurrences = new WeakMap<HTMLElement, InlineOccurrence>();
	const active = new Set<InlineOccurrence>();
	let disposed = false;

	const processor = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		if (disposed) return;
		const codes = [...(el.matches('code') ? [el] : []), ...Array.from(el.querySelectorAll<HTMLElement>('code'))]
			.filter(code => !code.closest('pre'));
		// Find ownership before inspecting text: existing code DOM contains rendered results.
		const refresh = new Set<() => void>();
		const newCodes = codes.filter(code => {
			const existing = occurrences.get(code);
			if (!existing) return true;
			if (existing.context === ctx && existing.ownershipPath === ctx.sourcePath) {
				if (existing.reconcileSource()) refresh.add(existing.refresh);
				return false;
			}
			// The former host child must never unload the replacement owner.
			existing.dispose();
			return true;
		});
		for (const rerender of refresh) rerender();
		if (!newCodes.length) return;
		const section: InlineOccurrence[] = [];
		let sourcePath = ctx.sourcePath, pending = false;
		let unsubscribe = () => {};
		const render = () => {
			pending = false;
			if (disposed || !section.length) return;
			const settings = getSettings();
			const items = section.filter(occurrence => !occurrence.disposed);
			for (const occurrence of items) { occurrence.reconcileSource(); occurrence.restore(); }
			if (!settings.enableInlineNumerals || !items.some(occurrence => parseInlineExpression(occurrence.source, getInlineTriggers(settings)))) return;
			try {
				const preProcessors = getPreProcessors();
				const metadata = getMetadataForFileAtPath(sourcePath, app, scopeCache);
				const { scope } = getScopeFromFrontmatter(metadata, undefined, settings.forceProcessAllFrontmatter, preProcessors);
				const previous: PrevResultRef = { value: undefined };
				const formatter = getFormatter();
				for (const occurrence of items) {
					occurrence.dependencies = processInlineCodeElement(occurrence.code, occurrence.source, scope, settings, formatter,
						preProcessors, previous, scopeCache, sourcePath, app);
					if (parseInlineExpression(occurrence.source, getInlineTriggers(settings))) occurrence.markRendered();
				}
			} catch (error) {
				for (const occurrence of items) {
					if (!parseInlineExpression(occurrence.source, getInlineTriggers(settings))) continue;
					renderInlineError(occurrence.code, occurrence.source);
					occurrence.code.title = error instanceof Error ? error.message : 'Unable to render this calculation.';
					occurrence.markRendered();
				}
			}
		};
		for (const code of newCodes) {
			const occurrence = new InlineOccurrence(code, ctx, render, () => {
				active.delete(occurrence); occurrences.delete(code);
				section.splice(section.indexOf(occurrence), 1);
				if (!section.length) { pending = false; unsubscribe(); }
			});
			occurrences.set(code, occurrence); active.add(occurrence); section.push(occurrence);
			ctx.addChild(occurrence);
		}
		unsubscribe = events.subscribe(event => {
			if (event.kind === 'unload') { processor.dispose(); return; }
			if (!section.some(occurrence => affectsOccurrence(event, sourcePath, occurrence.dependencies.dependencies, occurrence.dependencies.referencedPaths))) return;
			if (event.kind === 'rename' && event.oldPath === sourcePath) sourcePath = event.newPath;
			if (pending || disposed) return;
			pending = true;
			void Promise.resolve().then(() => { if (pending) render(); });
		});
		render();
	};
	processor.dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const occurrence of [...active]) occurrence.dispose();
		ownedEvents?.dispose();
	};
	return processor;
}
