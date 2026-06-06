/**
 * Unit tests for renderer implementations (Phase 3 refactoring).
 * Tests the Strategy Pattern implementation for different rendering styles.
 */

// Mock Obsidian functions before imports
jest.mock('obsidian', () => ({
	renderMath: jest.fn((tex: string) => {
		const span = document.createElement('span');
		span.textContent = `TeX:${tex}`;
		return span;
	}),
	finishRenderMath: jest.fn().mockResolvedValue(undefined),
	sanitizeHTMLToDom: jest.fn((html: string) => {
		const fragment = document.createDocumentFragment();
		const div = document.createElement('div');
		div.innerHTML = html;
		fragment.appendChild(div);
		return fragment;
	}),
}));

import {
	PlainRenderer,
	TeXRenderer,
	SyntaxHighlightRenderer,
	RendererFactory,
} from '../src/renderers';
import {
	LineRenderData,
	RenderContext,
	NumeralsRenderStyle,
	DEFAULT_SETTINGS,
} from '../src/numerals.types';
import { getLocaleFormatter } from '../src/numeralsUtilities';
import * as math from 'mathjs';

// Mock Obsidian DOM methods
beforeAll(() => {
	for (const unit of ['USD', 'CAD']) {
		try {
			math.createUnit(unit, { aliases: [unit.toLowerCase()] });
		} catch {
			/* unit already exists */
		}
	}

	Object.defineProperty(HTMLElement.prototype, 'createEl', {
		value: jest.fn(function (this: HTMLElement, tag, options) {
			const element = document.createElement(tag);
			if (options) {
				if (options.cls) {
					const classes = Array.isArray(options.cls) ? options.cls : [options.cls];
					classes.forEach((cls: string) => element.classList.add(cls));
				}
				if (options.text) element.textContent = String(options.text);
			}
			this.appendChild(element);
			return element;
		}),
		writable: true,
		configurable: true,
	});

	Object.defineProperty(HTMLElement.prototype, 'toggleClass', {
		value: function (className: string, value: boolean) {
			if (value) this.classList.add(className);
			else this.classList.remove(className);
		},
		writable: true,
		configurable: true,
	});

	Object.defineProperty(HTMLElement.prototype, 'setText', {
		value: function (text: string) {
			this.textContent = text;
		},
		writable: true,
		configurable: true,
	});
});

describe('Renderer Implementations', () => {
	let container: HTMLElement;
	let context: RenderContext;

	beforeEach(() => {
		container = document.createElement('div');
		context = {
			renderStyle: NumeralsRenderStyle.Plain,
			settings: DEFAULT_SETTINGS,
			numberFormat: getLocaleFormatter(),
			currencyUnitNames: new Set(['USD', 'CAD']),
			preProcessors: [],
		};
	});

	describe('PlainRenderer', () => {
		let renderer: PlainRenderer;

		beforeEach(() => {
			renderer = new PlainRenderer();
		});

		it('should render normal line with result', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '2 + 2',
				processedInput: '2 + 2',
				result: 4,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			const result = container.querySelector('.numerals-result');

			expect(input).not.toBeNull();
			expect(result).not.toBeNull();
			expect(input?.textContent).toBe('2 + 2');
			expect(result?.textContent).toContain('4');
		});

		it('should render empty line', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '',
				processedInput: '',
				result: undefined,
				isEmpty: true,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			const result = container.querySelector('.numerals-result');

			expect(input?.classList.contains('numerals-empty')).toBe(true);
			expect(result?.classList.contains('numerals-empty')).toBe(true);
		});

		it('should render line with comment', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '2 + 2',
				processedInput: '2 + 2',
				result: 4,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: '# sum',
			};

			renderer.renderLine(container, lineData, context);

			const comment = container.querySelector('.numerals-inline-comment');
			expect(comment).not.toBeNull();
			expect(comment?.textContent).toBe('# sum');
		});

		it('should highlight @sum directive', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: 'total = @sum',
				processedInput: 'total = __total',
				result: 10,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const sumElement = container.querySelector('.numerals-sum');
			expect(sumElement).not.toBeNull();
			expect(sumElement?.textContent).toBe('@sum');
		});

		it('should highlight @total directive', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: 'result = @total',
				processedInput: 'result = __total',
				result: 20,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const totalElement = container.querySelector('.numerals-sum');
			expect(totalElement).not.toBeNull();
			expect(totalElement?.textContent).toBe('@total');
		});

		it.each([
			['120 USD', '120.00 USD'],
			['120.1 USD', '120.10 USD'],
			['120.3499 USD', '120.35 USD'],
		])('formats pure USD currency result %s with exactly two decimals', (expression, expected) => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: `$${expression.split(' ')[0]}`,
				processedInput: expression,
				result: math.evaluate(expression),
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};
			context = {
				...context,
				currencyUnitNames: new Set(['USD']),
			} as RenderContext & { currencyUnitNames: Set<string> };

			renderer.renderLine(container, lineData, context);

			const result = container.querySelector('.numerals-result');
			expect(result?.textContent).toBe(` → ${expected}`);
		});

		it('formats configured non-USD currency units from the currency map', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '$120.1',
				processedInput: '120.1 CAD',
				result: math.evaluate('120.1 CAD'),
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};
			context = {
				...context,
				currencyUnitNames: new Set(['CAD']),
			} as RenderContext & { currencyUnitNames: Set<string> };

			renderer.renderLine(container, lineData, context);

			const result = container.querySelector('.numerals-result');
			expect(result?.textContent).toBe(' → 120.10 CAD');
		});

		it('leaves compound currency rates under existing precision behavior', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '$0.042/floz',
				processedInput: '0.042 USD / floz',
				result: math.evaluate('0.042 USD / floz'),
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};
			context = {
				...context,
				currencyUnitNames: new Set(['USD']),
			} as RenderContext & { currencyUnitNames: Set<string> };

			renderer.renderLine(container, lineData, context);

			const result = container.querySelector('.numerals-result');
			expect(result?.textContent).toBe(' → 0.042 USD / floz');
		});

		it('keeps non-currency numeric results on the selected number format', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '120',
				processedInput: '120',
				result: 120,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};
			context = {
				...context,
				currencyUnitNames: new Set(['USD']),
			} as RenderContext & { currencyUnitNames: Set<string> };

			renderer.renderLine(container, lineData, context);

			const result = container.querySelector('.numerals-result');
			expect(result?.textContent).toBe(' → 120');
		});
	});

	describe('SyntaxHighlightRenderer', () => {
		let renderer: SyntaxHighlightRenderer;

		beforeEach(() => {
			renderer = new SyntaxHighlightRenderer();
		});

		it('should render normal line with result', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '2 + 2',
				processedInput: '2 + 2',
				result: 4,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			const result = container.querySelector('.numerals-result');

			expect(input).not.toBeNull();
			expect(result).not.toBeNull();
			expect(result?.textContent).toContain('4');
		});

		it('should render empty line', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '',
				processedInput: '',
				result: undefined,
				isEmpty: true,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			const result = container.querySelector('.numerals-result');

			expect(input?.classList.contains('numerals-empty')).toBe(true);
			expect(result?.classList.contains('numerals-empty')).toBe(true);
		});

		it('should render line with comment', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '2 + 2',
				processedInput: '2 + 2',
				result: 4,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: '# calculation',
			};

			renderer.renderLine(container, lineData, context);

			const comment = container.querySelector('.numerals-inline-comment');
			expect(comment).not.toBeNull();
			expect(comment?.textContent).toBe('# calculation');
		});

		it('should render large numbers without scientific notation (issue #118)', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: 'Budget = 226000',
				processedInput: 'Budget = 226000',
				result: 226000,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			expect(input).not.toBeNull();

			// The input should contain "226000", not "2.26e+5"
			const inputHtml = input?.innerHTML || '';
			expect(inputHtml).toContain('226000');
			expect(inputHtml).not.toContain('e+');
		});

		it('should render numbers >= 100000 in fixed notation in input', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: 'x = 100000 + 200000',
				processedInput: 'x = 100000 + 200000',
				result: 300000,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			const inputHtml = input?.innerHTML || '';
			expect(inputHtml).toContain('100000');
			expect(inputHtml).toContain('200000');
			expect(inputHtml).not.toContain('e+');
		});
	});

	describe('TeXRenderer', () => {
		let renderer: TeXRenderer;

		beforeEach(() => {
			renderer = new TeXRenderer();
		});

		it('should render normal line', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '2 + 2',
				processedInput: '2 + 2',
				result: 4,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			const result = container.querySelector('.numerals-result');

			expect(input).not.toBeNull();
			expect(result).not.toBeNull();

			// Should have TeX spans
			const texSpans = container.querySelectorAll('.numerals-tex');
			expect(texSpans.length).toBe(2); // input and result
		});

		it('should render empty line', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: '',
				processedInput: '',
				result: undefined,
				isEmpty: true,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			renderer.renderLine(container, lineData, context);

			const input = container.querySelector('.numerals-input');
			const result = container.querySelector('.numerals-result');

			expect(input?.classList.contains('numerals-empty')).toBe(true);
			expect(result?.classList.contains('numerals-empty')).toBe(true);
		});

		it('should render line with comment', () => {
			const lineData: LineRenderData = {
				index: 0,
				rawInput: 'x = 5',
				processedInput: 'x = 5',
				result: 5,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: '# variable',
			};

			renderer.renderLine(container, lineData, context);

			const comment = container.querySelector('.numerals-inline-comment');
			expect(comment).not.toBeNull();
			expect(comment?.textContent).toBe('# variable');
		});
	});

	describe('RendererFactory', () => {
		it('should create PlainRenderer for Plain style', () => {
			const renderer = RendererFactory.createRenderer(NumeralsRenderStyle.Plain);
			expect(renderer).toBeInstanceOf(PlainRenderer);
		});

		it('should create TeXRenderer for TeX style', () => {
			const renderer = RendererFactory.createRenderer(NumeralsRenderStyle.TeX);
			expect(renderer).toBeInstanceOf(TeXRenderer);
		});

		it('should create SyntaxHighlightRenderer for SyntaxHighlight style', () => {
			const renderer = RendererFactory.createRenderer(
				NumeralsRenderStyle.SyntaxHighlight
			);
			expect(renderer).toBeInstanceOf(SyntaxHighlightRenderer);
		});
	});
});
