import * as math from 'mathjs';
import { LineRenderData, RenderContext } from '../numerals.types';
import { BaseLineRenderer } from './BaseLineRenderer';
import {
	texCurrencyReplacement,
	unescapeSubscripts,
	mathjaxLoop,
	replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw,
	getLocaleFormatter,
} from '../rendering/displayUtils';

/**
 * TeX renderer for Numerals blocks.
 *
 * Renders input and results using TeX notation with MathJax for display.
 * Provides mathematical typesetting with proper formatting for:
 * - Mathematical expressions
 * - Currency symbols
 * - Subscripts
 * - Sum/total directives
 */
export class TeXRenderer extends BaseLineRenderer {
	/**
	 * Renders a line in TeX style with MathJax.
	 *
	 * - Empty lines show raw input with comment
	 * - Non-empty lines convert input and result to TeX and render with MathJax
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
			// Non-empty line: render input and result as TeX
			this.renderInputTeX(inputElement, lineData);
			this.renderResultTeX(resultElement, lineData, context);

			// Add comment if present
			if (lineData.comment) {
				this.renderInlineComment(inputElement, lineData.comment);
			}
		}
	}

	/**
	 * Renders the input portion as TeX.
	 *
	 * Process:
	 * 1. Parse input to TeX using mathjs
	 * 2. Replace sum magic variable with @Sum directive
	 * 3. Unescape subscripts (e.g., x\_1 → x_{1})
	 * 4. Replace currency symbols with TeX commands
	 * 5. Render with MathJax
	 *
	 * @param inputElement - The input container element
	 * @param lineData - Prepared line data
	 * @private
	 */
	private renderInputTeX(inputElement: HTMLElement, lineData: LineRenderData): void {
		// Convert input to TeX
		const preprocessedTex = math.parse(lineData.processedInput).toTex();

		// Apply transformations
		let inputTex = replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(
			preprocessedTex,
			lineData.rawInput + (lineData.comment || ''),
			'@Sum()'
		);
		inputTex = unescapeSubscripts(inputTex);
		inputTex = texCurrencyReplacement(inputTex);

		// Render with MathJax
		const inputTexElement = inputElement.createEl('span', { cls: 'numerals-tex' });
		mathjaxLoop(inputTexElement, inputTex);
	}

	/**
	 * Renders the result portion as TeX.
	 *
	 * Process:
	 * 1. Format result to string with no grouping
	 * 2. Apply preprocessors (currency replacement)
	 * 3. Parse to TeX
	 * 4. Replace currency symbols with TeX commands
	 * 5. Render with MathJax
	 *
	 * @param resultElement - The result container element
	 * @param lineData - Prepared line data
	 * @param context - Rendering context with formatting options
	 * @private
	 */
	private renderResultTeX(
		resultElement: HTMLElement,
		lineData: LineRenderData,
		context: RenderContext
	): void {
		// Format result to string with reasonable precision, no grouping
		let processedResult = math.format(
			lineData.result,
			getLocaleFormatter('en-US', { useGrouping: false })
		);

		// Apply preprocessors (reverse currency transformations for parsing)
		for (const processor of context.preProcessors) {
			processedResult = processedResult.replace(processor.regex, processor.replaceStr);
		}

		// Convert to TeX
		let texResult = math.parse(processedResult).toTex();
		texResult = texCurrencyReplacement(texResult);

		// Render with MathJax
		const resultTexElement = resultElement.createEl('span', { cls: 'numerals-tex' });
		mathjaxLoop(resultTexElement, texResult);
	}
}
