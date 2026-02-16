/**
 * Tests for InlineNumeralsWidget (the CM6 WidgetType).
 *
 * Tests the DOM output and equality logic. The ViewPlugin itself
 * requires a real CM6 EditorView with Obsidian's syntax tree and
 * cannot be meaningfully unit-tested, but the widget is pure DOM.
 */

jest.mock('obsidian', () => ({
	editorInfoField: {},
	editorLivePreviewField: {},
}), { virtual: true });

jest.mock('obsidian-dataview', () => ({
	getAPI: () => () => {},
}), { virtual: true });

import { InlineNumeralsWidget } from '../src/inline/inlineLivePreview';
import { InlineNumeralsMode } from '../src/numerals.types';

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
			// Should NOT have equation sub-elements
			expect(el.querySelector('.numerals-inline-input')).toBeNull();
			expect(el.querySelector('.numerals-inline-separator')).toBeNull();
		});

		it('should render equation mode with input, separator, and value spans', () => {
			const widget = new InlineNumeralsWidget(
				'5 ft', InlineNumeralsMode.Equation, '3ft + 2ft', ' = ', false
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline')).toBe(true);
			expect(el.classList.contains('numerals-inline-equation')).toBe(true);

			const input = el.querySelector('.numerals-inline-input');
			const sep = el.querySelector('.numerals-inline-separator');
			const value = el.querySelector('.numerals-inline-value');

			expect(input?.textContent).toBe('3ft + 2ft');
			expect(sep?.textContent).toBe(' = ');
			expect(value?.textContent).toBe('5 ft');
		});

		it('should render custom separator', () => {
			const widget = new InlineNumeralsWidget(
				'5', InlineNumeralsMode.Equation, '3 + 2', ' → ', false
			);
			const el = widget.toDOM();
			expect(el.querySelector('.numerals-inline-separator')?.textContent).toBe(' → ');
		});

		it('should render error mode with raw expression', () => {
			const widget = new InlineNumeralsWidget(
				'', InlineNumeralsMode.ResultOnly, 'bad expression', ' = ', true
			);
			const el = widget.toDOM();

			expect(el.classList.contains('numerals-inline')).toBe(true);
			expect(el.classList.contains('numerals-inline-error')).toBe(true);
			expect(el.textContent).toBe('bad expression');
			// Error should NOT have structured sub-elements
			expect(el.querySelector('.numerals-inline-value')).toBeNull();
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
			const b = new InlineNumeralsWidget('5', InlineNumeralsMode.Equation, '3+2', ' → ', false);
			expect(a.eq(b)).toBe(false);
		});
	});
});
