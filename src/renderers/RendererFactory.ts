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
	private static readonly renderers = new Map<NumeralsRenderStyle, ILineRenderer>();

	/**
	 * Returns a cached renderer instance for the specified render style,
	 * creating one if it doesn't already exist.
	 *
	 * Renderers are stateless, so a single instance per style is reused.
	 *
	 * @param style - The rendering style (Plain, TeX, or SyntaxHighlight)
	 * @returns A renderer instance implementing ILineRenderer
	 *
	 * @throws Error if an unknown render style is provided
	 */
	static createRenderer(style: NumeralsRenderStyle): ILineRenderer {
		const cached = this.renderers.get(style);
		if (cached) return cached;

		let renderer: ILineRenderer;
		switch (style) {
			case NumeralsRenderStyle.Plain:
				renderer = new PlainRenderer(); break;
			case NumeralsRenderStyle.TeX:
				renderer = new TeXRenderer(); break;
			case NumeralsRenderStyle.SyntaxHighlight:
				renderer = new SyntaxHighlightRenderer(); break;
			default:
				// This should never happen with TypeScript enum, but provides safety
				throw new Error(`Unknown render style: ${String(style)}`);
		}
		this.renderers.set(style, renderer);
		return renderer;
	}
}
