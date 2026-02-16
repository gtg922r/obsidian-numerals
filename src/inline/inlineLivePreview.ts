/**
 * Live Preview (CM6 ViewPlugin) for inline Numerals expressions.
 *
 * Renders inline code spans that match a Numerals trigger prefix as
 * evaluated math results directly in the editor. Works alongside the
 * Reading-mode post-processor (`inlinePostProcessor.ts`).
 *
 * The plugin walks the CM6 syntax tree on each relevant update, finds
 * inline-code nodes, checks for trigger prefixes, evaluates the math,
 * and replaces the code span with a styled widget — unless the cursor
 * is inside the span (so the user can edit).
 */

import {
	EditorView,
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	WidgetType,
} from '@codemirror/view';
import { EditorState, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
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
 * Widget
 ****************************************************/

/**
 * A CM6 widget that renders the evaluated result of an inline Numerals expression.
 *
 * Supports three visual modes:
 * - **ResultOnly**: Displays only the computed result.
 * - **Equation**: Displays `expression <separator> result`.
 * - **Error**: Displays the raw expression with error styling.
 */
export class InlineNumeralsWidget extends WidgetType {
	constructor(
		private readonly resultText: string,
		private readonly mode: InlineNumeralsMode,
		private readonly rawExpression: string,
		private readonly separator: string,
		private readonly isError: boolean,
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
			this.isError === other.isError
		);
	}

	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.classList.add('numerals-inline');

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
 * Decoration builder
 ****************************************************/

/**
 * Build a `DecorationSet` for all inline Numerals expressions visible in the
 * current editor state.
 *
 * Iterates the Lezer syntax tree looking for `inline-code` nodes, parses
 * their text for a Numerals trigger, evaluates the expression, and (when
 * the cursor is not inside the span) creates a `Decoration.replace` that
 * swaps the raw source with the rendered widget.
 */
function buildDecorations(
	state: EditorState,
	getSettings: () => NumeralsSettings,
	getNumberFormat: () => mathjsFormat | undefined,
	preProcessors: StringReplaceMap[],
	scopeCache: Map<string, NumeralsScope>,
	app: App,
): DecorationSet {
	const settings = getSettings();

	// Feature gate
	if (!settings.enableInlineNumerals) {
		return Decoration.none;
	}

	// Only operate in Live Preview mode (not Source mode)
	try {
		if (!state.field(editorLivePreviewField)) {
			return Decoration.none;
		}
	} catch {
		// Field not available (e.g. in tests) — bail out
		return Decoration.none;
	}

	const resultTrigger = settings.inlineResultTrigger;
	const equationTrigger = settings.inlineEquationTrigger;

	// Guard against empty triggers
	if (!resultTrigger && !equationTrigger) {
		return Decoration.none;
	}

	// Resolve the file scope once (lazy — only if we find a matching expression)
	let scope: NumeralsScope | null = null;
	function getScope(): NumeralsScope {
		if (scope !== null) return scope;

		let filePath = '';
		try {
			const editorInfo = state.field(editorInfoField);
			filePath = editorInfo?.file?.path ?? '';
		} catch {
			// field not available
		}

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

	const numberFormat = getNumberFormat();

	// Cursor position — we skip decorating spans the cursor is inside
	const cursorHead = state.selection.main.head;

	const decorations: Range<Decoration>[] = [];

	syntaxTree(state).iterate({
		enter(node) {
			// Obsidian's CM6 Lezer grammar labels inline code content as "inline-code".
			// We do a substring check to be resilient against minor grammar changes.
			if (!node.type.name.includes('inline-code')) {
				return;
			}

			// Skip nodes that are formatting delimiters (the backticks themselves)
			if (node.type.name.includes('formatting')) {
				return;
			}

			const contentFrom = node.from;
			const contentTo = node.to;

			const text = state.sliceDoc(contentFrom, contentTo);

			const parsed = parseInlineExpression(text, resultTrigger, equationTrigger);
			if (!parsed) return;

			// Cursor guard: if the cursor is anywhere from the opening backtick
			// to the closing backtick (inclusive), let the user edit freely.
			// The backtick delimiters are 1 character each surrounding the content.
			const spanFrom = contentFrom - 1; // opening backtick
			const spanTo = contentTo + 1;     // closing backtick

			if (cursorHead >= spanFrom && cursorHead <= spanTo) {
				return;
			}

			// Evaluate the expression
			let resultText: string;
			let isError = false;

			try {
				resultText = evaluateInlineExpression(
					parsed.expression,
					getScope(),
					numberFormat,
					preProcessors,
				);
			} catch {
				resultText = '';
				isError = true;
			}

			const widget = new InlineNumeralsWidget(
				resultText,
				parsed.mode,
				parsed.expression,
				settings.inlineEquationSeparator,
				isError,
			);

			// Replace the entire inline code span (backticks included) with the widget
			decorations.push(
				Decoration.replace({ widget }).range(spanFrom, spanTo),
			);
		},
	});

	// DecorationSet requires ranges to be sorted by `from` position.
	// syntaxTree.iterate visits nodes in document order, so they should
	// already be sorted — but we sort defensively just in case.
	decorations.sort((a, b) => a.from - b.from);

	return Decoration.set(decorations);
}

/****************************************************
 * ViewPlugin factory
 ****************************************************/

/**
 * Creates a CM6 `Extension` that renders inline Numerals expressions
 * as evaluated widgets in Obsidian's Live Preview mode.
 *
 * @param getSettings  - Returns current plugin settings (called on each update for hot-reload)
 * @param getNumberFormat - Returns the active mathjs number format
 * @param preProcessors - String replacement preprocessors (currency symbols, etc.)
 * @param scopeCache - Shared cache of per-file variable scopes
 * @param app - The Obsidian App instance
 * @returns A CM6 Extension to register via `Plugin.registerEditorExtension()`
 */
export function createInlineLivePreviewExtension(
	getSettings: () => NumeralsSettings,
	getNumberFormat: () => mathjsFormat | undefined,
	preProcessors: StringReplaceMap[],
	scopeCache: Map<string, NumeralsScope>,
	app: App,
) {
	return ViewPlugin.fromClass(
		class InlineNumeralsViewPlugin {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(
					view.state,
					getSettings,
					getNumberFormat,
					preProcessors,
					scopeCache,
					app,
				);
			}

			update(update: ViewUpdate): void {
				// Only rebuild when something relevant changed
				if (
					update.docChanged ||
					update.selectionSet ||
					update.viewportChanged
				) {
					this.decorations = buildDecorations(
						update.state,
						getSettings,
						getNumberFormat,
						preProcessors,
						scopeCache,
						app,
					);
				}
			}
		},
		{
			decorations: (plugin) => plugin.decorations,
		},
	);
}
