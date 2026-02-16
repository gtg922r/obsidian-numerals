import * as math from 'mathjs';
import { LineRenderData, RenderContext } from '../numerals.types';
import { BaseLineRenderer } from './BaseLineRenderer';
import {
	htmlToElements,
	replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw,
} from '../rendering/displayUtils';

/**
 * Syntax highlighting renderer for Numerals blocks.
 *
 * Renders input with HTML syntax highlighting using mathjs's toHTML() method.
 * Results are displayed as plain formatted numbers.
 */
export class SyntaxHighlightRenderer extends BaseLineRenderer {
	/**
	 * Renders a line with syntax highlighting.
	 *
	 * - Empty lines show raw input with comment
	 * - Non-empty lines show HTML-highlighted input and formatted result
	 *
	 * @param container - The line container element
	 * @param lineData - Prepared line data
	 * @param context - Rendering context with settings and formatting
	 */
	renderLine(
		container: HTMLElement,
		lineData: LineRenderData,
		context: RenderContext
	): void {
		const { inputElement, resultElement } = this.createElements(container);

		if (lineData.isEmpty) {
			// Empty line: show raw input (usually comment or blank)
			const displayText = lineData.rawInput + (lineData.comment || '');
			inputElement.setText(displayText);
			resultElement.setText('\xa0');
			this.handleEmptyLine(inputElement, resultElement);
		} else {
			// Non-empty line: render input with syntax highlighting
			this.renderInputHighlighted(inputElement, lineData);
			this.renderFormattedResult(resultElement, lineData, context);

			// Add comment if present
			if (lineData.comment) {
				this.renderInlineComment(inputElement, lineData.comment);
			}
		}
	}

	/**
	 * Renders the input portion with syntax highlighting.
	 *
	 * Process:
	 * 1. Parse input to HTML using mathjs
	 * 2. Replace sum magic variable with @sum directive
	 * 3. Sanitize HTML to DOM
	 * 4. Append to input element
	 *
	 * @param inputElement - The input container element
	 * @param lineData - Prepared line data
	 * @private
	 */
	private renderInputHighlighted(
		inputElement: HTMLElement,
		lineData: LineRenderData
	): void {
		// Convert input to highlighted HTML
		const inputHtml = math.parse(lineData.processedInput).toHTML();

		// Replace magic sum variable with directive from raw input
		const processedHtml = replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(
			inputHtml,
			lineData.rawInput + (lineData.comment || '')
		);

		// Convert HTML string to sanitized DOM elements
		const inputElements = htmlToElements(processedHtml);
		inputElement.appendChild(inputElements);
	}

}
