/**
 * Unit tests for line preparation functions introduced in Phase 2 refactoring.
 * Tests extraction functions for comments, input cleaning, and line data preparation.
 */

import {
	extractComment,
	renderComment,
	cleanRawInput,
	prepareLineData,
} from '../src/numeralsUtilities';
import {
	NumeralsSettings,
	DEFAULT_SETTINGS,
	numeralsBlockInfo,
} from '../src/numerals.types';

describe('Line Preparation Functions', () => {
	describe('extractComment', () => {
		it('should extract comment from input with comment', () => {
			const result = extractComment('2 + 2 # this is a comment');
			expect(result.inputWithoutComment).toBe('2 + 2 ');
			expect(result.comment).toBe('# this is a comment');
		});

		it('should handle input without comment', () => {
			const result = extractComment('2 + 2');
			expect(result.inputWithoutComment).toBe('2 + 2');
			expect(result.comment).toBeNull();
		});

		it('should handle empty string', () => {
			const result = extractComment('');
			expect(result.inputWithoutComment).toBe('');
			expect(result.comment).toBeNull();
		});

		it('should extract comment with special characters', () => {
			const result = extractComment('x = 5 # value=$100, rate=20%');
			expect(result.inputWithoutComment).toBe('x = 5 ');
			expect(result.comment).toBe('# value=$100, rate=20%');
		});

		it('should handle multiple # symbols (only first starts comment)', () => {
			const result = extractComment('2 + 2 # comment with # inside');
			expect(result.inputWithoutComment).toBe('2 + 2 ');
			expect(result.comment).toBe('# comment with # inside');
		});

		it('should handle comment at start of line', () => {
			const result = extractComment('# This is a heading');
			expect(result.inputWithoutComment).toBe('');
			expect(result.comment).toBe('# This is a heading');
		});

		it('should preserve whitespace before comment', () => {
			const result = extractComment('x = 5   # comment');
			expect(result.inputWithoutComment).toBe('x = 5   ');
			expect(result.comment).toBe('# comment');
		});
	});

	describe('renderComment', () => {
		let container: HTMLElement;

		beforeEach(() => {
			container = document.createElement('div');
			// Mock createEl for Obsidian
			Object.defineProperty(HTMLElement.prototype, 'createEl', {
				value: jest.fn(function(this: HTMLElement, tag, options) {
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
		});

		it('should render comment with correct class', () => {
			renderComment(container, '# this is a comment');

			const commentEl = container.querySelector('.numerals-inline-comment');
			expect(commentEl).not.toBeNull();
			expect(commentEl?.textContent).toBe('# this is a comment');
		});

		it('should render empty comment', () => {
			renderComment(container, '#');

			const commentEl = container.querySelector('.numerals-inline-comment');
			expect(commentEl).not.toBeNull();
			expect(commentEl?.textContent).toBe('#');
		});

		it('should render comment with special characters', () => {
			renderComment(container, '# $100 => 20%');

			const commentEl = container.querySelector('.numerals-inline-comment');
			expect(commentEl?.textContent).toBe('# $100 => 20%');
		});
	});

	describe('cleanRawInput', () => {
		let settings: NumeralsSettings;

		beforeEach(() => {
			settings = { ...DEFAULT_SETTINGS };
		});

		it('should remove emitter markup when hideEmitterMarkupInInput is true', () => {
			settings.hideEmitterMarkupInInput = true;
			const result = cleanRawInput('result = 42 =>', settings);
			expect(result).toBe('result = 42');
		});

		it('should preserve emitter markup when hideEmitterMarkupInInput is false', () => {
			settings.hideEmitterMarkupInInput = false;
			const result = cleanRawInput('result = 42 =>', settings);
			expect(result).toBe('result = 42 =>');
		});

		it('should remove result insertion directive', () => {
			const result = cleanRawInput('@[profit::100]', settings);
			expect(result).toBe('profit');
		});

		it('should remove result insertion directive with no existing value', () => {
			const result = cleanRawInput('@[result]', settings);
			expect(result).toBe('result');
		});

		it('should remove result insertion directive inline', () => {
			const result = cleanRawInput('@[profit::100] = sales - costs', settings);
			expect(result).toBe('profit = sales - costs');
		});

		it('should handle both emitter and insertion directives', () => {
			settings.hideEmitterMarkupInInput = true;
			const result = cleanRawInput('@[result::5] = 2 + 3 =>', settings);
			expect(result).toBe('result = 2 + 3');
		});

		it('should handle input with no directives', () => {
			const result = cleanRawInput('2 + 2', settings);
			expect(result).toBe('2 + 2');
		});

		it('should handle empty string', () => {
			const result = cleanRawInput('', settings);
			expect(result).toBe('');
		});

		it('should handle emitter with whitespace variations', () => {
			settings.hideEmitterMarkupInInput = true;
			const result1 = cleanRawInput('x=5=>', settings);
			const result2 = cleanRawInput('x = 5  =>  ', settings);
			const result3 = cleanRawInput('x = 5\t=>\t', settings);

			expect(result1).toBe('x=5');
			expect(result2).toBe('x = 5');
			expect(result3).toBe('x = 5');
		});

		it('should handle result insertion with spaces', () => {
			const result = cleanRawInput('@ [ result :: 100 ]', settings);
			expect(result).toBe(' result ');
		});
	});

	describe('prepareLineData', () => {
		let settings: NumeralsSettings;
		let blockInfo: numeralsBlockInfo;

		beforeEach(() => {
			settings = { ...DEFAULT_SETTINGS };
			blockInfo = {
				emitter_lines: [],
				insertion_lines: [],
				hidden_lines: [],
				shouldHideNonEmitterLines: false,
			};
		});

		it('should prepare data for normal line', () => {
			const rawRows = ['2 + 2'];
			const inputs = ['2 + 2'];
			const results = [4];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.index).toBe(0);
			expect(lineData.rawInput).toBe('2 + 2');
			expect(lineData.processedInput).toBe('2 + 2');
			expect(lineData.result).toBe(4);
			expect(lineData.isEmpty).toBe(false);
			expect(lineData.isEmitter).toBe(false);
			expect(lineData.isHidden).toBe(false);
			expect(lineData.comment).toBeNull();
		});

		it('should prepare data for line with comment', () => {
			const rawRows = ['2 + 2 # sum'];
			const inputs = ['2 + 2'];
			const results = [4];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.rawInput).toBe('2 + 2 ');
			expect(lineData.comment).toBe('# sum');
		});

		it('should identify empty line', () => {
			const rawRows = [''];
			const inputs = [''];
			const results = [undefined];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.isEmpty).toBe(true);
			expect(lineData.result).toBeUndefined();
		});

		it('should identify emitter line', () => {
			blockInfo.emitter_lines = [0];
			const rawRows = ['2 + 2 =>'];
			const inputs = ['2 + 2'];
			const results = [4];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.isEmitter).toBe(true);
			expect(lineData.isHidden).toBe(false);
		});

		it('should identify hidden line', () => {
			blockInfo.hidden_lines = [0];
			const rawRows = ['@hideRows'];
			const inputs = [''];
			const results = [undefined];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.isHidden).toBe(true);
		});

		it('should hide non-emitter lines when shouldHideNonEmitterLines is true', () => {
			blockInfo.shouldHideNonEmitterLines = true;
			blockInfo.emitter_lines = [1];

			const rawRows = ['intermediate = 10', 'result = 20 =>'];
			const inputs = ['intermediate = 10', 'result = 20'];
			const results = [10, 20];

			const lineData0 = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);
			const lineData1 = prepareLineData(1, rawRows, inputs, results, blockInfo, settings);

			expect(lineData0.isHidden).toBe(true); // Non-emitter should be hidden
			expect(lineData1.isHidden).toBe(false); // Emitter should not be hidden
		});

		it('should clean emitter markup from raw input', () => {
			settings.hideEmitterMarkupInInput = true;
			blockInfo.emitter_lines = [0];

			const rawRows = ['result = 42 =>'];
			const inputs = ['result = 42'];
			const results = [42];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.rawInput).toBe('result = 42');
		});

		it('should clean insertion directive from raw input', () => {
			const rawRows = ['@[profit::100] = sales - costs'];
			const inputs = ['profit = sales - costs'];
			const results = [100];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.rawInput).toBe('profit = sales - costs');
		});

		it('should handle line with both comment and directives', () => {
			settings.hideEmitterMarkupInInput = true;
			blockInfo.emitter_lines = [0];

			const rawRows = ['result = 42 => # final answer'];
			const inputs = ['result = 42'];
			const results = [42];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.rawInput).toBe('result = 42');
			expect(lineData.comment).toBe('# final answer');
		});

		it('should handle missing index in rawRows', () => {
			const rawRows: string[] = [];
			const inputs = [''];
			const results = [undefined];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.rawInput).toBe('');
			expect(lineData.isEmpty).toBe(true);
		});

		it('should handle missing index in inputs', () => {
			const rawRows = ['2 + 2'];
			const inputs: string[] = [];
			const results = [4];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.processedInput).toBe('');
		});

		it('should prepare data for comment-only line', () => {
			const rawRows = ['# This is a heading'];
			const inputs = ['# This is a heading'];
			const results = [undefined];

			const lineData = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);

			expect(lineData.isEmpty).toBe(true);
			expect(lineData.comment).toBe('# This is a heading');
			expect(lineData.rawInput).toBe(''); // Comment extracted, input is empty
		});

		it('should handle multiple lines with various characteristics', () => {
			blockInfo.emitter_lines = [2];
			blockInfo.shouldHideNonEmitterLines = false;
			settings.hideEmitterMarkupInInput = true;

			const rawRows = [
				'# Header',
				'x = 10 # intermediate',
				'result = x * 2 => # final',
			];
			const inputs = ['# Header', 'x = 10', 'result = x * 2'];
			const results = [undefined, 10, 20];

			const lineData0 = prepareLineData(0, rawRows, inputs, results, blockInfo, settings);
			const lineData1 = prepareLineData(1, rawRows, inputs, results, blockInfo, settings);
			const lineData2 = prepareLineData(2, rawRows, inputs, results, blockInfo, settings);

			// Line 0: Comment-only
			expect(lineData0.isEmpty).toBe(true);
			expect(lineData0.comment).toBe('# Header');

			// Line 1: Normal line with comment
			expect(lineData1.isEmpty).toBe(false);
			expect(lineData1.result).toBe(10);
			expect(lineData1.comment).toBe('# intermediate');
			expect(lineData1.isEmitter).toBe(false);

			// Line 2: Emitter line with comment
			expect(lineData2.isEmpty).toBe(false);
			expect(lineData2.result).toBe(20);
			expect(lineData2.comment).toBe('# final');
			expect(lineData2.isEmitter).toBe(true);
			expect(lineData2.rawInput).toBe('result = x * 2');
		});
	});
});
