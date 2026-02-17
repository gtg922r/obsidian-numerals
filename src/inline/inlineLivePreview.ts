/**
 * Live Preview (CM6 ViewPlugin) for inline Numerals expressions.
 *
 * Renders inline code spans that match a Numerals trigger prefix as
 * evaluated math results directly in the editor. Works alongside the
 * Reading-mode post-processor (`inlinePostProcessor.ts`).
 *
 * ## Update strategy
 *
 * Rather than rebuilding all decorations from scratch on every change,
 * the plugin uses an incremental approach inspired by Dataview:
 *
 * - **docChanged**: Map existing decorations through the change set
 *   (shifts positions without re-evaluation), then walk the visible
 *   ranges to add new / remove stale decorations.
 * - **selectionSet**: Walk visible ranges to handle cursor guard
 *   (reveal raw source when cursor enters a span).
 * - **viewportChanged**: Full rebuild of visible ranges only.
 *
 * ## Formatting context
 *
 * When inline code sits inside bold, italic, highlight, or
 * strikethrough, the widget inherits those CM formatting classes so
 * the rendered result matches the surrounding text style.
 */

import {
	EditorView,
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	WidgetType,
} from '@codemirror/view';
import { EditorSelection, Range } from '@codemirror/state';
import { syntaxTree, tokenClassNodeProp } from '@codemirror/language';
import { App } from 'obsidian';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import {
	NumeralsSettings,
	NumeralsScope,
	mathjsFormat,
	StringReplaceMap,
	InlineNumeralsMode,
} from '../numerals.types';
import { getMetadataForFileAtPath, getScopeFromFrontmatter } from '../processing/scope';
import { parseInlineExpression } from './inlineParser';
import { evaluateInlineExpression } from './inlineEvaluator';

/****************************************************
 * Formatting context helpers
 ****************************************************/

/** CSS classes that correspond to Markdown formatting around inline code. */
const FORMATTING_CLASS_MAP: Record<string, string> = {
	strong: 'cm-strong',
	em: 'cm-em',
	highlight: 'cm-highlight',
	strikethrough: 'cm-strikethrough',
};

/**
 * Extract inherited CSS classes from a Lezer node's `tokenClassNodeProp`.
 *
 * When inline code appears inside `**bold**` or `*italic*`, the Lezer
 * token carries those formatting flags. We propagate them to the widget
 * so the rendered result matches the surrounding text style.
 */
export function getFormattingClasses(tokenProps: string | undefined): string[] {
	if (!tokenProps) return [];
	const propSet = tokenProps.split(' ');
	const classes: string[] = [];
	for (const prop of propSet) {
		const cls = FORMATTING_CLASS_MAP[prop];
		if (cls) classes.push(cls);
	}
	return classes;
}

/****************************************************
 * Selection overlap helper
 ****************************************************/

/**
 * Check whether any selection range overlaps with [from, to].
 * Used for the cursor guard — when the cursor is inside an inline
 * code span, we skip decoration so the user can edit the raw source.
 */
export function selectionOverlapsRange(
	selection: EditorSelection,
	from: number,
	to: number,
): boolean {
	for (const range of selection.ranges) {
		if (range.from <= to && range.to >= from) {
			return true;
		}
	}
	return false;
}

/****************************************************
 * Widget
 ****************************************************/

/**
 * A CM6 widget that renders the evaluated result of an inline Numerals expression.
 *
 * Supports three visual modes:
 * - **ResultOnly**: Displays only the computed result.
 * - **Equation**: Displays `expression <separator> result`.
 * - **Error**: Displays the raw expression with error styling.
 *
 * Optionally carries formatting CSS classes (bold, italic, etc.)
 * inherited from the surrounding Markdown context.
 */
export class InlineNumeralsWidget extends WidgetType {
	constructor(
		private readonly resultText: string,
		private readonly mode: InlineNumeralsMode,
		private readonly rawExpression: string,
		private readonly separator: string,
		private readonly isError: boolean,
		private readonly formattingClasses: string[] = [],
	) {
		super();
	}

	/**
	 * Equality check used by CM6 to avoid unnecessary DOM updates.
	 * All fields must match for the widget to be considered unchanged.
	 */
	eq(other: InlineNumeralsWidget): boolean {
		return (
			this.resultText === other.resultText &&
			this.mode === other.mode &&
			this.rawExpression === other.rawExpression &&
			this.separator === other.separator &&
			this.isError === other.isError &&
			this.formattingClasses.length === other.formattingClasses.length &&
			this.formattingClasses.every((c, i) => c === other.formattingClasses[i])
		);
	}

	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.classList.add('cm-inline-code', 'numerals-inline');

		// Apply inherited formatting (bold, italic, etc.)
		for (const cls of this.formattingClasses) {
			span.classList.add(cls);
		}

		if (this.isError) {
			span.classList.add('numerals-inline-error');
			span.textContent = this.rawExpression;
			return span;
		}

		if (this.mode === InlineNumeralsMode.Equation) {
			span.classList.add('numerals-inline-equation');

			const inputEl = document.createElement('span');
			inputEl.className = 'numerals-inline-input';
			inputEl.textContent = this.rawExpression;

			const sepEl = document.createElement('span');
			sepEl.className = 'numerals-inline-separator';
			sepEl.textContent = this.separator;

			const valueEl = document.createElement('span');
			valueEl.className = 'numerals-inline-value';
			valueEl.textContent = this.resultText;

			span.appendChild(inputEl);
			span.appendChild(sepEl);
			span.appendChild(valueEl);
		} else {
			// ResultOnly
			span.classList.add('numerals-inline-result');

			const valueEl = document.createElement('span');
			valueEl.className = 'numerals-inline-value';
			valueEl.textContent = this.resultText;

			span.appendChild(valueEl);
		}

		return span;
	}
}

/****************************************************
 * Shared context for decoration building
 ****************************************************/

/** Read-only context assembled once per decoration pass. */
interface DecorationContext {
	settings: NumeralsSettings;
	resultTrigger: string;
	equationTrigger: string;
	numberFormat: mathjsFormat | undefined;
	preProcessors: StringReplaceMap[];
	getScope: () => NumeralsScope;
}

/**
 * Create the shared context used during a decoration pass.
 * Returns `null` if the feature is disabled or triggers are empty.
 */
function createDecorationContext(
	getSettings: () => NumeralsSettings,
	getNumberFormat: () => mathjsFormat | undefined,
	preProcessors: StringReplaceMap[],
	scopeCache: Map<string, NumeralsScope>,
	app: App,
	filePath: string,
): DecorationContext | null {
	const settings = getSettings();

	if (!settings.enableInlineNumerals) return null;

	const resultTrigger = settings.inlineResultTrigger;
	const equationTrigger = settings.inlineEquationTrigger;
	if (!resultTrigger && !equationTrigger) return null;

	// Lazy scope resolution — only built on first matching expression
	let scope: NumeralsScope | null = null;
	function getScope(): NumeralsScope {
		if (scope !== null) return scope;

		if (filePath) {
			const metadata = getMetadataForFileAtPath(filePath, app, scopeCache);
			const result = getScopeFromFrontmatter(
				metadata,
				undefined,
				settings.forceProcessAllFrontmatter,
				preProcessors,
			);
			scope = result.scope;
		} else {
			scope = new NumeralsScope();
		}

		return scope;
	}

	return {
		settings,
		resultTrigger,
		equationTrigger,
		numberFormat: getNumberFormat(),
		preProcessors,
		getScope,
	};
}

/****************************************************
 * Single-node decoration builder
 ****************************************************/

/**
 * Attempt to build a Decoration for a single inline-code syntax node.
 * Returns the decoration Range if the node matches a trigger and the
 * cursor is not inside, otherwise returns `null`.
 */
function tryBuildNodeDecoration(
	nodeFrom: number,
	nodeTo: number,
	tokenProps: string | undefined,
	doc: { sliceString(from: number, to: number): string },
	selection: EditorSelection,
	ctx: DecorationContext,
): Range<Decoration> | null {
	const text = doc.sliceString(nodeFrom, nodeTo);

	const parsed = parseInlineExpression(text, ctx.resultTrigger, ctx.equationTrigger);
	if (!parsed) return null;

	// Span includes backtick delimiters (1 char each side)
	const spanFrom = nodeFrom - 1;
	const spanTo = nodeTo + 1;

	// Cursor guard: reveal raw source when cursor overlaps
	if (selectionOverlapsRange(selection, spanFrom, spanTo)) {
		return null;
	}

	// Evaluate
	let resultText: string;
	let isError = false;
	try {
		resultText = evaluateInlineExpression(
			parsed.expression,
			ctx.getScope(),
			ctx.numberFormat,
			ctx.preProcessors,
		);
	} catch {
		resultText = '';
		isError = true;
	}

	const formattingClasses = getFormattingClasses(tokenProps);

	const widget = new InlineNumeralsWidget(
		resultText,
		parsed.mode,
		parsed.expression,
		ctx.settings.inlineEquationSeparator,
		isError,
		formattingClasses,
	);

	return Decoration.replace({ widget }).range(spanFrom, spanTo);
}

/****************************************************
 * Full rebuild (visible ranges only)
 ****************************************************/

/**
 * Build a complete `DecorationSet` by scanning all visible ranges.
 * Used on initial load and viewport changes.
 */
function buildDecorations(
	view: EditorView,
	ctx: DecorationContext,
): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	const { state } = view;
	const selection = state.selection;

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter(node) {
				const tokenProps = node.type.prop(tokenClassNodeProp);
				const props = tokenProps?.split(' ');

				// Match inline-code content, skip formatting delimiters (backticks)
				if (!props?.includes('inline-code') || props.includes('formatting')) {
					return;
				}

				const deco = tryBuildNodeDecoration(
					node.from, node.to, tokenProps,
					state.doc, selection, ctx,
				);
				if (deco) decorations.push(deco);
			},
		});
	}

	return Decoration.set(decorations, true);
}

/****************************************************
 * Incremental update (visible ranges only)
 ****************************************************/

/**
 * Incrementally update an existing DecorationSet after a doc change
 * or selection change.
 *
 * 1. Walk visible ranges of the syntax tree.
 * 2. For each inline-code node that matches a trigger:
 *    - If cursor overlaps → ensure no decoration exists (remove if needed)
 *    - If cursor doesn't overlap → ensure a decoration exists (add if needed)
 * 3. For nodes that don't match → remove any stale decoration.
 *
 * This avoids re-evaluating unchanged expressions on every keystroke.
 */
function updateDecorations(
	existing: DecorationSet,
	view: EditorView,
	ctx: DecorationContext,
): DecorationSet {
	const { state } = view;
	const selection = state.selection;
	let updated = existing;

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter(node) {
				const tokenProps = node.type.prop(tokenClassNodeProp);
				const props = tokenProps?.split(' ');

				if (!props?.includes('inline-code') || props.includes('formatting')) {
					return;
				}

				const spanFrom = node.from - 1;
				const spanTo = node.to + 1;

				// Check if a decoration already exists at this range
				let hasExisting = false;
				updated.between(spanFrom, spanTo, () => { hasExisting = true; });

				const deco = tryBuildNodeDecoration(
					node.from, node.to, tokenProps,
					state.doc, selection, ctx,
				);

				if (deco && !hasExisting) {
					// New decoration needed — add it
					updated = updated.update({ add: [deco] });
				} else if (!deco && hasExisting) {
					// Decoration should be removed (cursor entered, or expression removed)
					updated = updated.update({
						filterFrom: spanFrom,
						filterTo: spanTo,
						filter: () => false,
					});
				} else if (deco && hasExisting) {
					// Expression may have changed — replace
					// (Widget.eq() will prevent DOM update if content is identical)
					updated = updated.update({
						filterFrom: spanFrom,
						filterTo: spanTo,
						filter: () => false,
						add: [deco],
					});
				}
			},
		});
	}

	return updated;
}

/****************************************************
 * ViewPlugin factory
 ****************************************************/

/**
 * Creates a CM6 `Extension` that renders inline Numerals expressions
 * as evaluated widgets in Obsidian's Live Preview mode.
 *
 * @param getSettings     - Returns current plugin settings (called on each update for hot-reload)
 * @param getNumberFormat - Returns the active mathjs number format
 * @param getPreProcessors - Returns current string replacement preprocessors (currency symbols, etc.)
 * @param scopeCache        - Shared cache of per-file variable scopes
 * @param app               - The Obsidian App instance
 * @returns A CM6 Extension to register via `Plugin.registerEditorExtension()`
 */
export function createInlineLivePreviewExtension(
	getSettings: () => NumeralsSettings,
	getNumberFormat: () => mathjsFormat | undefined,
	getPreProcessors: () => StringReplaceMap[],
	scopeCache: Map<string, NumeralsScope>,
	app: App,
) {
	return ViewPlugin.fromClass(
		class InlineNumeralsViewPlugin {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				try {
					if (!view.state.field(editorLivePreviewField)) {
						this.decorations = Decoration.none;
						return;
					}
				} catch {
					this.decorations = Decoration.none;
					return;
				}
				this.decorations = this.build(view) ?? Decoration.none;
			}

			update(update: ViewUpdate): void {
				// Only active in Live Preview (not Source mode)
				try {
					if (!update.state.field(editorLivePreviewField)) {
						this.decorations = Decoration.none;
						return;
					}
				} catch {
					this.decorations = Decoration.none;
					return;
				}

				if (update.docChanged) {
					// Map existing decorations through the change set (shifts
					// positions without re-evaluation), then incrementally
					// add/remove for affected visible ranges.
					this.decorations = this.decorations.map(update.changes);
					const ctx = this.createContext(update.view);
					if (ctx) {
						this.decorations = updateDecorations(
							this.decorations, update.view, ctx,
						);
					}
				} else if (update.selectionSet) {
					// Cursor moved — only need to update cursor guard
					// (add/remove decorations near the cursor)
					const ctx = this.createContext(update.view);
					if (ctx) {
						this.decorations = updateDecorations(
							this.decorations, update.view, ctx,
						);
					}
				} else if (update.viewportChanged) {
					// Viewport changed (scroll) — full rebuild of visible ranges
					this.decorations = this.build(update.view) ?? Decoration.none;
				}
			}

			/** Full rebuild of decorations for visible ranges. */
			private build(view: EditorView): DecorationSet | null {
				const ctx = this.createContext(view);
				if (!ctx) return null;
				return buildDecorations(view, ctx);
			}

			/** Create a decoration context from current plugin state. */
			private createContext(view: EditorView): DecorationContext | null {
				let filePath = '';
				try {
					filePath = view.state.field(editorInfoField)?.file?.path ?? '';
				} catch { /* field not available */ }

				return createDecorationContext(
					getSettings,
					getNumberFormat,
					getPreProcessors(),
					scopeCache,
					app,
					filePath,
				);
			}
		},
		{
			decorations: (plugin) => plugin.decorations,
		},
	);
}
