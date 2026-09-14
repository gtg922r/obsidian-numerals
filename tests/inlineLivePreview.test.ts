/**
 * Tests for InlineNumeralsWidget and Live Preview helpers.
 *
 * Tests the DOM output, equality logic, formatting class extraction,
 * and selection overlap checking. The ViewPlugin is exercised with real CM6 EditorViews in inlineHostLifecycle.test.ts.
 */

jest.mock('obsidian', () => ({
	loadMathJax: jest.fn().mockResolvedValue(undefined),
	editorInfoField: {},
	editorLivePreviewField: {},
	renderMath: jest.fn((tex: string) => {
		const span = document.createElement('span');
		span.textContent = `TeX:${tex}`;
		return span;
	}),
	finishRenderMath: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

jest.mock('obsidian-dataview', () => ({
	getAPI: () => () => {},
}), { virtual: true });

import {
	InlineNumeralsWidget,
	getFormattingClasses,
	selectionOverlapsRange,
} from '../src/inline/inlineLivePreview';
import { InlineNumeralsMode, NumeralsRenderStyle } from '../src/numerals.types';
import type { FormattedResult } from '../src/formatting';
import { EditorSelection } from '@codemirror/state';
import { renderMath } from 'obsidian';

beforeAll(() => {
	(globalThis as { activeDocument?: Document }).activeDocument = document;
});

beforeEach(() => {
	jest.clearAllMocks();
});

function formatted(
	text: string,
	tex: string = text,
	canonical: string = text,
): FormattedResult {
	return { text, tex, canonical };
}

// ---------------------------------------------------------------------------
// getFormattingClasses
// ---------------------------------------------------------------------------

describe('getFormattingClasses', () => {
	it('should return empty array for undefined', () => {
		expect(getFormattingClasses(undefined)).toEqual([]);
	});

	it('should return empty array for unrecognized props', () => {
		expect(getFormattingClasses('inline-code')).toEqual([]);
	});

	it('should extract cm-strong for "strong"', () => {
		expect(getFormattingClasses('inline-code strong')).toEqual(['cm-strong']);
	});

	it('should extract cm-em for "em"', () => {
		expect(getFormattingClasses('em inline-code')).toEqual(['cm-em']);
	});

	it('should extract multiple formatting classes', () => {
		const result = getFormattingClasses('inline-code strong em highlight strikethrough');
		expect(result).toEqual(['cm-strong', 'cm-em', 'cm-highlight', 'cm-strikethrough']);
	});

	it('should return empty array for empty string', () => {
		expect(getFormattingClasses('')).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// selectionOverlapsRange
// ---------------------------------------------------------------------------

describe('selectionOverlapsRange', () => {
	it('should return true when cursor is inside range', () => {
		const sel = EditorSelection.single(15);
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(true);
	});

	it('should return true when cursor is at range start', () => {
		const sel = EditorSelection.single(10);
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(true);
	});

	it('should return true when cursor is at range end', () => {
		const sel = EditorSelection.single(20);
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(true);
	});

	it('should return false when cursor is before range', () => {
		const sel = EditorSelection.single(5);
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(false);
	});

	it('should return false when cursor is after range', () => {
		const sel = EditorSelection.single(25);
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(false);
	});

	it('should return true when a text selection overlaps', () => {
		const sel = EditorSelection.single(5, 15); // selection from 5 to 15
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(true);
	});

	it('should handle multiple selection ranges', () => {
		const sel = EditorSelection.create([
			EditorSelection.range(1, 3),
			EditorSelection.range(15, 15),
		]);
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(true);
	});

	it('should return false when no selection range overlaps', () => {
		const sel = EditorSelection.create([
			EditorSelection.range(1, 3),
			EditorSelection.range(25, 30),
		]);
		expect(selectionOverlapsRange(sel, 10, 20)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// InlineNumeralsWidget
// ---------------------------------------------------------------------------

describe('InlineNumeralsWidget', () => {
	describe('toDOM', () => {
		it('should render result-only mode with value span', () => {
			const widget = new InlineNumeralsWidget(
				formatted('36 in'), InlineNumeralsMode.ResultOnly, '3ft in inches', ' = ', false
			);
			const el = widget.toDOM();

			expect(el.tagName).toBe('SPAN');
			expect(el.classList.contains('cm-inline-code')).toBe(true);
			expect(el.classList.contains('numerals-inline')).toBe(true);
			expect(el.classList.contains('numerals-inline-result')).toBe(true);
			expect(el.querySelector('.numerals-inline-value')?.textContent).toBe('36 in');
			expect(el.querySelector('.numerals-inline-input')).toBeNull();
			expect(el.querySelector('.numerals-inline-separator')).toBeNull();
		});

		it('should render result-only TeX mode with MathJax inside the value span', async () => {
			const widget = new InlineNumeralsWidget(
				formatted('36', '36'), InlineNumeralsMode.ResultOnly, '3ft in inches', ' = ', false,
				[], NumeralsRenderStyle.TeX, '3 ft in inches'
			);
			const el = widget.toDOM();
			await Promise.resolve(); await Promise.resolve();

			expect(el.classList.contains('numerals-inline-result')).toBe(true);
			expect(el.querySelector('.numerals-inline-value .numerals-tex')?.textContent).toBe('TeX:36');
			expect(renderMath).toHaveBeenCalledWith('36', false);
		});

		it('should render equation mode with input, separator, and value spans', () => {
			const widget = new InlineNumeralsWidget(
				formatted('5 ft'), InlineNumeralsMode.Equation, '3ft + 2ft', ' = ', false
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline-equation')).toBe(true);
			expect(el.querySelector('.numerals-inline-input')?.textContent).toBe('3ft + 2ft');
			expect(el.querySelector('.numerals-inline-separator')?.textContent).toBe(' = ');
			expect(el.querySelector('.numerals-inline-value')?.textContent).toBe('5 ft');
		});

		it('shows an owned diagnostic when MathJax rendering fails', async () => {
			// Synchronous MathJax failure is contained by the owned async renderer.
			(renderMath as jest.Mock).mockImplementationOnce(() => {
				throw new Error('MathJax unavailable');
			});
			const widget = new InlineNumeralsWidget(
				formatted('36', '36'), InlineNumeralsMode.ResultOnly, '3ft in inches', ' = ', false,
				[], NumeralsRenderStyle.TeX, '3 ft in inches'
			);
			const el = widget.toDOM();
			await Promise.resolve(); await Promise.resolve();

			expect(el.querySelector('.numerals-inline-value .numerals-tex')?.textContent).toContain('MathJax unavailable');
		});

		it('should render equation TeX mode with MathJax input and value spans', async () => {
			const widget = new InlineNumeralsWidget(
				formatted('12', '12'), InlineNumeralsMode.Equation, 'sqrt(144)', ' = ', false,
				[], NumeralsRenderStyle.TeX, '\\sqrt{144}'
			);
			const el = widget.toDOM();
			await Promise.resolve(); await Promise.resolve();

			expect(el.querySelector('.numerals-inline-input .numerals-tex')?.textContent).toBe('TeX:\\sqrt{144}');
			expect(el.querySelector('.numerals-inline-separator')?.textContent).toBe(' = ');
			expect(el.querySelector('.numerals-inline-value .numerals-tex')?.textContent).toBe('TeX:12');
			expect(renderMath).toHaveBeenNthCalledWith(1, '\\sqrt{144}', false);
			expect(renderMath).toHaveBeenNthCalledWith(2, '12', false);
		});

		it('should create widget nodes from the editor ownerDocument', () => {
			const editorDocument = document.implementation.createHTMLDocument('editor');
			const editorDom = editorDocument.createElement('div');
			const widget = new InlineNumeralsWidget(
				formatted('5 ft'), InlineNumeralsMode.Equation, '3ft + 2ft', ' = ', false
			);

			const el = widget.toDOM({ dom: editorDom } as unknown as Parameters<InlineNumeralsWidget['toDOM']>[0]);

			expect(el.ownerDocument).toBe(editorDocument);
			expect(el.querySelector('.numerals-inline-input')?.ownerDocument).toBe(editorDocument);
			expect(el.querySelector('.numerals-inline-separator')?.ownerDocument).toBe(editorDocument);
			expect(el.querySelector('.numerals-inline-value')?.ownerDocument).toBe(editorDocument);
		});

		it('should render error mode with raw expression', () => {
			const widget = new InlineNumeralsWidget(
				formatted(''), InlineNumeralsMode.ResultOnly, 'bad expression', ' = ', true
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline-error')).toBe(true);
			expect(el.textContent).toContain('bad expression');
			expect(el.textContent).toContain('Unable to evaluate');
			expect(el.querySelector('.numerals-inline-value')).toBeNull();
		});

		it('should apply formatting classes (bold)', () => {
			const widget = new InlineNumeralsWidget(
				formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong']
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline')).toBe(true);
			expect(el.classList.contains('cm-strong')).toBe(true);
		});

		it('should apply multiple formatting classes', () => {
			const widget = new InlineNumeralsWidget(
				formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false,
				['cm-strong', 'cm-em', 'cm-highlight']
			);
			const el = widget.toDOM();

			expect(el.classList.contains('cm-strong')).toBe(true);
			expect(el.classList.contains('cm-em')).toBe(true);
			expect(el.classList.contains('cm-highlight')).toBe(true);
		});

		it('should apply formatting classes even on error widgets', () => {
			const widget = new InlineNumeralsWidget(
				formatted(''), InlineNumeralsMode.ResultOnly, 'bad', ' = ', true, ['cm-em']
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline-error')).toBe(true);
			expect(el.classList.contains('cm-em')).toBe(true);
		});
	});

	describe('eq', () => {
		it('should return true for identical widgets', () => {
			const a = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			expect(a.eq(b)).toBe(true);
		});

		it('should return false when result differs', () => {
			const a = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget(formatted('6'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when mode differs', () => {
			const a = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.Equation, '3+2', ' = ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when expression differs', () => {
			const a = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '2+3', ' = ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when error state differs', () => {
			const a = new InlineNumeralsWidget(formatted(''), InlineNumeralsMode.ResultOnly, 'x', ' = ', false);
			const b = new InlineNumeralsWidget(formatted(''), InlineNumeralsMode.ResultOnly, 'x', ' = ', true);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when separator differs', () => {
			const a = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.Equation, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.Equation, '3+2', ' \u2192 ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when formatting classes differ', () => {
			const a = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong']);
			const b = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, []);
			expect(a.eq(b)).toBe(false);
		});

		it('should return true when formatting classes match', () => {
			const a = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong', 'cm-em']);
			const b = new InlineNumeralsWidget(formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong', 'cm-em']);
			expect(a.eq(b)).toBe(true);
		});

		it('should return true for distinct but equivalent formatted result objects', () => {
			const a = new InlineNumeralsWidget(
				formatted('5 m', '5~\\mathrm{m}', '5 m'),
				InlineNumeralsMode.ResultOnly, '2m+3m', ' = ', false,
				[], NumeralsRenderStyle.TeX, '2m+3m'
			);
			const b = new InlineNumeralsWidget(
				formatted('5 m', '5~\\mathrm{m}', '5 m'),
				InlineNumeralsMode.ResultOnly, '2m+3m', ' = ', false,
				[], NumeralsRenderStyle.TeX, '2m+3m'
			);
			expect(a.eq(b)).toBe(true);
		});

		it('should return false when render style differs', () => {
			const plain = new InlineNumeralsWidget(
				formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false,
				[], NumeralsRenderStyle.Plain, '3+2'
			);
			const tex = new InlineNumeralsWidget(
				formatted('5'), InlineNumeralsMode.ResultOnly, '3+2', ' = ', false,
				[], NumeralsRenderStyle.TeX, '3+2'
			);

			expect(plain.eq(tex)).toBe(false);
		});
	});
});


it('keeps changed diagnostic reasons in safe visible text and widget equality', () => {
 const expression = 'rate <img src=x onerror=alert(1)>', firstReason = 'Undefined symbol: <script>rate</script>';
 const first = new InlineNumeralsWidget(formatted(''), InlineNumeralsMode.ResultOnly, expression, ' = ', true,
  [], NumeralsRenderStyle.Plain, undefined, firstReason);
 const second = new InlineNumeralsWidget(formatted(''), InlineNumeralsMode.ResultOnly, expression, ' = ', true,
  [], NumeralsRenderStyle.Plain, undefined, 'Metadata unavailable: repair the reference.');
 const dom = first.toDOM();
 expect(dom.textContent).toContain(expression); expect(dom.textContent).toContain(firstReason);
 expect(dom.querySelector('img, script, [aria-hidden="true"]')).toBeNull();
 expect(dom.querySelector('.numerals-error-message')?.textContent).toContain(firstReason);
 expect(first.eq(second)).toBe(false);
 expect(second.toDOM().textContent).toContain('Metadata unavailable: repair the reference.');
});
