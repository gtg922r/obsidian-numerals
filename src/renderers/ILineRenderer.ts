import { LineRenderData, RenderContext } from '../numerals.types';

/**
 * Interface for rendering a single line in a Numerals block.
 *
 * Implementations of this interface define how to render content
 * in different styles (Plain text, TeX, Syntax Highlighting).
 *
 * @example
 * ```typescript
 * class PlainRenderer implements ILineRenderer {
 *   renderLine(container: HTMLElement, lineData: LineRenderData, context: RenderContext): void {
 *     // Create plain text elements
 *     const input = container.createEl('span', { text: lineData.rawInput });
 *     const result = container.createEl('span', { text: formatResult(lineData.result) });
 *   }
 * }
 * ```
 */
export interface ILineRenderer {
	/**
	 * Renders a single line into the provided container element.
	 *
	 * This method should create and append DOM elements representing
	 * the input and result of a calculation line. The exact structure
	 * and styling depends on the implementation (Plain, TeX, Highlight).
	 *
	 * @param container - The HTML element to render into (typically a div.numerals-line)
	 * @param lineData - Prepared data for the line including input, result, metadata
	 * @param context - Rendering context including settings and formatting options
	 *
	 * @remarks
	 * Implementations should:
	 * - Create separate elements for input and result
	 * - Apply appropriate CSS classes for styling
	 * - Handle empty lines gracefully
	 * - Render comments if present in lineData
	 * - Respect settings from the RenderContext
	 */
	renderLine(
		container: HTMLElement,
		lineData: LineRenderData,
		context: RenderContext
	): void;
}
