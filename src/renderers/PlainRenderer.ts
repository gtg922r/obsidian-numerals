import { LineRenderData, RenderContext } from '../numerals.types';
import { BaseLineRenderer } from './BaseLineRenderer';

/**
 * Plain text renderer for Numerals blocks.
 *
 * Renders input and results as plain text without TeX or syntax highlighting.
 * Provides special handling for @sum/@total directives with highlighting.
 */
export class PlainRenderer extends BaseLineRenderer {
	/**
	 * Renders a line in plain text style.
	 *
	 * - Empty lines show raw input with comment
	 * - Non-empty lines show input and formatted result
	 * - @sum/@total directives get special CSS class
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
			inputElement.setText(lineData.rawInput + (lineData.comment || ''));
			resultElement.setText('\xa0');
			this.handleEmptyLine(inputElement, resultElement);
		} else {
			// Non-empty line: render input and result
			this.renderInput(inputElement, lineData);
			this.renderFormattedResult(resultElement, lineData, context);

			// Add comment if present
			if (lineData.comment) {
				this.renderInlineComment(inputElement, lineData.comment);
			}
		}
	}

	/**
	 * Renders the input portion of the line.
	 * Handles special rendering for @sum/@total directives.
	 *
	 * @param inputElement - The input container element
	 * @param lineData - Prepared line data
	 * @private
	 */
	private renderInput(inputElement: HTMLElement, lineData: LineRenderData): void {
		const inputText = lineData.rawInput;

		// Check for @sum or @total directive and highlight it
		if (/@sum|@total/i.test(inputText)) {
			this.renderSumDirective(inputElement, inputText);
		} else {
			inputElement.setText(inputText);
		}
	}

	/**
	 * Renders input containing @sum or @total with special highlighting.
	 *
	 * Splits the input into three parts:
	 * 1. Text before directive (normal)
	 * 2. The directive itself (highlighted with numerals-sum class)
	 * 3. Text after directive (normal)
	 *
	 * @param inputElement - The input container element
	 * @param inputText - The input text containing @sum or @total
	 * @private
	 */
	private renderSumDirective(inputElement: HTMLElement, inputText: string): void {
		const parts = inputText.match(/([^\r\n]*?)(@sum|@total)([^\r\n]*?)$/i) || [
			inputText,
			'',
			'',
			'',
		];

		inputElement.createEl('span', { text: parts[1] });
		inputElement.createEl('span', { text: parts[2], cls: 'numerals-sum' });
		inputElement.createEl('span', { text: parts[3] });
	}

}
