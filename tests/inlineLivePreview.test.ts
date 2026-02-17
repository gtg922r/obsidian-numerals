/**
 * Tests for InlineNumeralsWidget and Live Preview helpers.
 *
 * Tests the DOM output, equality logic, formatting class extraction,
 * and selection overlap checking. The ViewPlugin itself requires a
 * real CM6 EditorView and cannot be meaningfully unit-tested.
 */

jest.mock('obsidian', () => ({
	editorInfoField: {},
	editorLivePreviewField: {},
}), { virtual: true });

jest.mock('obsidian-dataview', () => ({
	getAPI: () => () => {},
}), { virtual: true });

import {
	InlineNumeralsWidget,
	getFormattingClasses,
	selectionOverlapsRange,
} from '../src/inline/inlineLivePreview';
import { InlineNumeralsMode } from '../src/numerals.types';
import { EditorSelection } from '@codemirror/state';

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
				'36 in', InlineNumeralsMode.ResultOnly, '3ft in inches', ' = ', false
			);
			const el = widget.toDOM();

			expect(el.tagName).toBe('SPAN');
			expect(el.classList.contains('numerals-inline')).toBe(true);
			expect(el.classList.contains('numerals-inline-result')).toBe(true);
			expect(el.querySelector('.numerals-inline-value')?.textContent).toBe('36 in');
			expect(el.querySelector('.numerals-inline-input')).toBeNull();
			expect(el.querySelector('.numerals-inline-separator')).toBeNull();
		});

		it('should render equation mode with input, separator, and value spans', () => {
			const widget = new InlineNumeralsWidget(
				'5 ft', InlineNumeralsMode.Equation, '3ft + 2ft', ' = ', false
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline-equation')).toBe(true);
			expect(el.querySelector('.numerals-inline-input')?.textContent).toBe('3ft + 2ft');
			expect(el.querySelector('.numerals-inline-separator')?.textContent).toBe(' = ');
			expect(el.querySelector('.numerals-inline-value')?.textContent).toBe('5 ft');
		});

		it('should render error mode with raw expression', () => {
			const widget = new InlineNumeralsWidget(
				'', InlineNumeralsMode.ResultOnly, 'bad expression', ' = ', true
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline-error')).toBe(true);
			expect(el.textContent).toBe('bad expression');
			expect(el.querySelector('.numerals-inline-value')).toBeNull();
		});

		it('should apply formatting classes (bold)', () => {
			const widget = new InlineNumeralsWidget(
				'5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong']
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline')).toBe(true);
			expect(el.classList.contains('cm-strong')).toBe(true);
		});

		it('should apply multiple formatting classes', () => {
			const widget = new InlineNumeralsWidget(
				'5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false,
				['cm-strong', 'cm-em', 'cm-highlight']
			);
			const el = widget.toDOM();

			expect(el.classList.contains('cm-strong')).toBe(true);
			expect(el.classList.contains('cm-em')).toBe(true);
			expect(el.classList.contains('cm-highlight')).toBe(true);
		});

		it('should apply formatting classes even on error widgets', () => {
			const widget = new InlineNumeralsWidget(
				'', InlineNumeralsMode.ResultOnly, 'bad', ' = ', true, ['cm-em']
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline-error')).toBe(true);
			expect(el.classList.contains('cm-em')).toBe(true);
		});
	});

	describe('eq', () => {
		it('should return true for identical widgets', () => {
			const a = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			expect(a.eq(b)).toBe(true);
		});

		it('should return false when result differs', () => {
			const a = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget('6', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when mode differs', () => {
			const a = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget('5', InlineNumeralsMode.Equation, '3+2', ' = ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when expression differs', () => {
			const a = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '2+3', ' = ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when error state differs', () => {
			const a = new InlineNumeralsWidget('', InlineNumeralsMode.ResultOnly, 'x', ' = ', false);
			const b = new InlineNumeralsWidget('', InlineNumeralsMode.ResultOnly, 'x', ' = ', true);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when separator differs', () => {
			const a = new InlineNumeralsWidget('5', InlineNumeralsMode.Equation, '3+2', ' = ', false);
			const b = new InlineNumeralsWidget('5', InlineNumeralsMode.Equation, '3+2', ' \u2192 ', false);
			expect(a.eq(b)).toBe(false);
		});

		it('should return false when formatting classes differ', () => {
			const a = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong']);
			const b = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, []);
			expect(a.eq(b)).toBe(false);
		});

		it('should return true when formatting classes match', () => {
			const a = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong', 'cm-em']);
			const b = new InlineNumeralsWidget('5', InlineNumeralsMode.ResultOnly, '3+2', ' = ', false, ['cm-strong', 'cm-em']);
			expect(a.eq(b)).toBe(true);
		});
	});
});
