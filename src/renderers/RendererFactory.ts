import { NumeralsRenderStyle } from '../numerals.types';
import { ILineRenderer } from './ILineRenderer';
import { PlainRenderer } from './PlainRenderer';
import { TeXRenderer } from './TeXRenderer';
import { SyntaxHighlightRenderer } from './SyntaxHighlightRenderer';

/**
 * Factory for creating line renderer instances based on render style.
 *
 * Implements the Factory Pattern to provide the appropriate renderer
 * implementation for each NumeralsRenderStyle.
 *
 * @example
 * ```typescript
 * const renderer = RendererFactory.createRenderer(NumeralsRenderStyle.TeX);
 * renderer.renderLine(container, lineData, context);
 * ```
 */
export class RendererFactory {
	/**
	 * Creates a renderer instance for the specified render style.
	 *
	 * @param style - The rendering style (Plain, TeX, or SyntaxHighlight)
	 * @returns A renderer instance implementing ILineRenderer
	 *
	 * @throws Error if an unknown render style is provided
	 */
	static createRenderer(style: NumeralsRenderStyle): ILineRenderer {
		switch (style) {
			case NumeralsRenderStyle.Plain:
				return new PlainRenderer();
			case NumeralsRenderStyle.TeX:
				return new TeXRenderer();
			case NumeralsRenderStyle.SyntaxHighlight:
				return new SyntaxHighlightRenderer();
			default:
				// This should never happen with TypeScript enum, but provides safety
				throw new Error(`Unknown render style: ${style}`);
		}
	}
}
