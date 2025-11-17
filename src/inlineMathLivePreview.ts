/**
 * Live Preview support for inline math expressions
 * Uses CodeMirror 6 ViewPlugin with proper mode detection and cursor handling
 * 
 * Important: CodeMirror syntax tree nodes for inline code point to the CONTENT (without backticks)
 * So when we get node.from and node.to, those positions are AFTER the opening backtick
 * and BEFORE the closing backtick. To replace the entire inline code including backticks,
 * we decorate from (node.from - 1) to (node.to + 1).
 */

import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	WidgetType
} from "@codemirror/view";
import { RangeSetBuilder, Extension, EditorSelection } from "@codemirror/state";
import { syntaxTree, tokenClassNodeProp } from "@codemirror/language";
import { editorLivePreviewField, editorInfoField, Component, TFile } from "obsidian";
import * as math from 'mathjs';
import { NumeralsScope, mathjsFormat, StringReplaceMap } from './numerals.types';
import { replaceStringsInTextFromMap, getScopeFromFrontmatter, addGreekLettersToScope } from './numeralsUtilities';

/**
 * Widget that displays the evaluated result
 * This widget is recreated on every decoration rebuild for simplicity,
 * ensuring it always has the latest scope, format, and preprocessors
 */
class InlineMathWidget extends WidgetType {
	constructor(
		private expression: string,
		private scope: NumeralsScope | undefined,
		private numberFormat: mathjsFormat,
		private preProcessors: StringReplaceMap[]
	) {
		super();
	}

	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.classList.add('numerals-inline-result');

		try {
			// Apply preprocessors to the expression
			let processedExpression = this.expression;
			if (this.preProcessors && this.preProcessors.length > 0) {
				processedExpression = replaceStringsInTextFromMap(processedExpression, this.preProcessors);
			}

			// Evaluate the expression using the page scope
			const result = math.evaluate(processedExpression, this.scope || new NumeralsScope());

			// Format the result
			const formattedResult = math.format(result, this.numberFormat);
			span.textContent = formattedResult;
		} catch (error) {
			span.classList.remove('numerals-inline-result');
			span.classList.add('numerals-inline-error');
			span.textContent = `[Error: ${error.message || 'Invalid expression'}]`;
		}

		return span;
	}

	eq(other: InlineMathWidget): boolean {
		// Always return false to force recreation on every update
		// This ensures we always have the latest scope/format values
		// Performance impact is minimal since inline expressions are lightweight
		return false;
	}
}

/**
 * Check if cursor is within a range
 */
function cursorIntersectsRange(selection: EditorSelection, from: number, to: number): boolean {
	return selection.ranges.some(range => {
		return (range.from <= to && range.to >= from);
	});
}

/**
 * Creates a ViewPlugin for Live Preview mode inline math rendering
 * 
 * Key behaviors:
 * - Only renders in Live Preview mode (not Source mode)
 * - Hides decorations when cursor is over inline code (allows editing)
 * - Uses proper syntax tree detection via tokenClassNodeProp
 * - Gets full metadata including frontmatter for expression evaluation
 * - Manages Component lifecycle for proper cleanup
 */
export function createInlineMathViewPlugin(
	getScopeForFile: (path: string) => NumeralsScope | undefined,
	getNumberFormat: () => mathjsFormat,
	getPreProcessors: () => StringReplaceMap[],
	getApp: () => any
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			component: Component;

			constructor(view: EditorView) {
				this.component = new Component();
				this.component.load();
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				// Only rebuild on relevant changes
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			destroy() {
				this.component.unload();
			}

			buildDecorations(view: EditorView): DecorationSet {
				// Check if we're in Live Preview mode
				const isLivePreview = view.state.field(editorLivePreviewField);
				
				// If not in Live Preview mode (i.e., in Source mode), return no decorations
				if (!isLivePreview) {
					return Decoration.none;
				}

				const builder = new RangeSetBuilder<Decoration>();
				const selection = view.state.selection;

				// Get the file path using proper Obsidian API
				const file = view.state.field(editorInfoField).file;
				const filePath = file ? file.path : '';
				
				// Get current format and preprocessors dynamically
				const numberFormat = getNumberFormat();
				const preProcessors = getPreProcessors();
				const app = getApp();
				
				// Get scope for this file (may be undefined if no code blocks yet)
				let scope = getScopeForFile(filePath);
				
				// Get frontmatter and process it properly through getScopeFromFrontmatter
				if (app && filePath) {
					try {
						const handle = app.vault.getAbstractFileByPath(filePath);
						const f_handle = (handle instanceof TFile) ? handle : undefined;
						const f_cache = f_handle ? app.metadataCache.getFileCache(f_handle as TFile) : undefined;
						const frontmatter = f_cache?.frontmatter;
						
						if (frontmatter) {
							// Process frontmatter through getScopeFromFrontmatter to properly convert values
							scope = getScopeFromFrontmatter(frontmatter, scope, false, preProcessors, false);
						}
					} catch (e) {
						console.warn('Numerals: Failed to get frontmatter for inline expressions:', e);
					}
				}
				
				// Add Greek letters to scope so they can be used in expressions
				scope = addGreekLettersToScope(scope);

				// Process each visible range
				for (const { from, to } of view.visibleRanges) {
					// Use syntax tree to find inline code nodes
					syntaxTree(view.state).iterate({
						from,
						to,
						enter: (node) => {
							// Proper inline code detection using tokenClassNodeProp
							const type = node.type;
							const tokenProps = type.prop<String>(tokenClassNodeProp);
							const props = new Set(tokenProps?.split(" "));
							
							// Check if this is inline code content (not formatting characters)
							if (props.has("inline-code") && !props.has("formatting")) {
								// node.from and node.to point to content INSIDE backticks
								const start = node.from;
								const end = node.to;
								
								// Get the text content (does NOT include backticks)
								const text = view.state.doc.sliceString(start, end);
								
								// Check if this is a mathexpr inline expression
								const match = text.match(/^mathexpr:\s*(.+)$/);
								if (match) {
									const expression = match[1].trim();
									
									// Check if cursor is in this range (including backticks)
									// We check start-1 to end+1 to include the backtick positions
									if (cursorIntersectsRange(selection, start - 1, end + 1)) {
										return; // Skip decoration to allow editing
									}

									// Create a widget to display the result
									const widget = new InlineMathWidget(
										expression,
										scope,
										numberFormat,
										preProcessors
									);

									// Replace the ENTIRE inline code including backticks
									// start-1 is the opening backtick, end+1 is the closing backtick
									builder.add(
										start - 1,
										end + 1,
										Decoration.replace({
											widget,
										})
									);
								}
							}
						}
					});
				}

				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations,
		}
	);
}
