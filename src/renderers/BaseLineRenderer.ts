import { LineRenderData, RenderContext } from '../numerals.types';
import { renderComment } from '../numeralsUtilities';
import { ILineRenderer } from './ILineRenderer';

/**
 * Abstract base class for line renderers implementing common functionality.
 *
 * This class provides shared logic for all renderer implementations:
 * - Empty line handling
 * - Comment rendering
 * - Common CSS class application
 *
 * Subclasses must implement the abstract renderLine method to define
 * how input and result are rendered for their specific style.
 */
export abstract class BaseLineRenderer implements ILineRenderer {
	/**
	 * Renders a line into the provided container.
	 * Must be implemented by subclasses to define style-specific rendering.
	 *
	 * @param container - The HTML element to render into
	 * @param lineData - Prepared data for the line
	 * @param context - Rendering context with settings and formatting
	 */
	abstract renderLine(
		container: HTMLElement,
		lineData: LineRenderData,
		context: RenderContext
	): void;

	/**
	 * Renders a comment into the input element.
	 * Called by subclass implementations to add inline comments.
	 *
	 * @param inputElement - The input element to append the comment to
	 * @param comment - The comment string (including #)
	 * @protected
	 */
	protected renderInlineComment(inputElement: HTMLElement, comment: string): void {
		renderComment(inputElement, comment);
	}

	/**
	 * Applies empty line CSS classes to input and result elements.
	 * Sets the non-breaking space character for empty results.
	 *
	 * @param inputElement - The input element
	 * @param resultElement - The result element
	 * @protected
	 */
	protected handleEmptyLine(inputElement: HTMLElement, resultElement: HTMLElement): void {
		inputElement.toggleClass('numerals-empty', true);
		resultElement.toggleClass('numerals-empty', true);
		resultElement.setText('\xa0'); // Non-breaking space
	}

	/**
	 * Creates input and result container elements with standard CSS classes.
	 * This provides a consistent structure for all renderer types.
	 *
	 * @param container - The line container element
	 * @returns Object with inputElement and resultElement
	 * @protected
	 */
	protected createElements(container: HTMLElement): {
		inputElement: HTMLElement;
		resultElement: HTMLElement;
	} {
		const inputElement = container.createEl('span', { cls: 'numerals-input' });
		const resultElement = container.createEl('span', { cls: 'numerals-result' });
		return { inputElement, resultElement };
	}
}
