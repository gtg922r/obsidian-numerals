/**
 * Unit tests for result insertion side effect function (Phase 4 refactoring).
 * Tests the isolated side effect of writing results back to the editor.
 */

import { handleResultInsertions } from '../src/numeralsUtilities';
import { getLocaleFormatter } from '../src/numeralsUtilities';
import { App, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';

// Mock Obsidian types
type MockEditor = {
	getLine: jest.Mock;
	setLine: jest.Mock;
};

type MockContext = {
	getSectionInfo: jest.Mock;
	sourcePath: string;
};

describe('handleResultInsertions', () => {
	let mockEditor: MockEditor;
	let mockApp: Partial<App>;
	let mockCtx: MockContext;
	let mockEl: HTMLElement;
	let numberFormat: any;

	beforeEach(() => {
		// Mock editor
		mockEditor = {
			getLine: jest.fn(),
			setLine: jest.fn(),
		};

		// Mock app with iterateAllLeaves that finds our mock editor
		mockApp = {
			workspace: {
				iterateAllLeaves: jest.fn((callback: (leaf: any) => void) => {
					callback({
						view: Object.assign(Object.create(MarkdownView.prototype), {
							file: { path: 'test.md' },
							editor: mockEditor,
						}),
					});
				}),
			} as any,
		};

		// Mock context
		mockCtx = {
			getSectionInfo: jest.fn(),
			sourcePath: 'test.md',
		};

		// Mock element
		mockEl = document.createElement('div');

		// Number format
		numberFormat = getLocaleFormatter();

		// Clear setTimeout mock
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should insert result into source line with no existing value', () => {
		const results = [100];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@[profit] = sales - costs');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		// Fast-forward timers
		jest.runAllTimers();

		expect(mockEditor.setLine).toHaveBeenCalledWith(
			1,
			'@[profit::100] = sales - costs'
		);
	});

	it('should update existing result value', () => {
		const results = [150];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@[profit::100] = sales - costs');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).toHaveBeenCalledWith(
			1,
			'@[profit::150] = sales - costs'
		);
	});

	it('should handle multiple insertion lines', () => {
		const results = [100, 200, 300];
		const insertionLines = [0, 2];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 5 });
		mockEditor.getLine
			.mockReturnValueOnce('@[result1]')
			.mockReturnValueOnce('@[result2::0]');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).toHaveBeenCalledTimes(2);
		expect(mockEditor.setLine).toHaveBeenNthCalledWith(1, 6, '@[result1::100]');
		expect(mockEditor.setLine).toHaveBeenNthCalledWith(2, 8, '@[result2::300]');
	});

	it('should not modify line if value has not changed', () => {
		const results = [100];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@[profit::100]');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).not.toHaveBeenCalled();
	});

	it('should handle line with spaces in directive', () => {
		const results = [50];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@ [ result :: 0 ]');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		// The regex preserves the spaces in the brackets
		expect(mockEditor.setLine).toHaveBeenCalledWith(1, '@ [ result ::50]');
	});

	it('should handle insertion directive inline with expression', () => {
		const results = [42];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@[answer::0] = 6 * 7');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).toHaveBeenCalledWith(1, '@[answer::42] = 6 * 7');
	});

	it('should skip when section info is undefined', () => {
		const results = [100];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue(null);

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).not.toHaveBeenCalled();
	});

	it('should skip when lineStart is undefined', () => {
		const results = [100];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: undefined });

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).not.toHaveBeenCalled();
	});

	it('should skip when editor is not available', () => {
		const results = [100];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		// Override iterateAllLeaves to provide no matching leaves
		(mockApp.workspace as any).iterateAllLeaves = jest.fn();

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).not.toHaveBeenCalled();
	});

	it('should handle empty insertion lines array', () => {
		const results = [100, 200, 300];
		const insertionLines: number[] = [];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).not.toHaveBeenCalled();
	});

	it('should format numeric results correctly', () => {
		const results = [1234.5678];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@[value]');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		// The exact format depends on locale, but should be numeric
		const call = mockEditor.setLine.mock.calls[0];
		expect(call[0]).toBe(1);
		expect(call[1]).toMatch(/@\[value::\d+/);
	});

	it('should preserve text after insertion directive', () => {
		const results = [99];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@[count] = total # comment');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		expect(mockEditor.setLine).toHaveBeenCalledWith(
			1,
			'@[count::99] = total # comment'
		);
	});

	it('should use setTimeout to defer editor modification', () => {
		const results = [100];
		const insertionLines = [0];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine.mockReturnValue('@[value]');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		// Should not have been called yet
		expect(mockEditor.setLine).not.toHaveBeenCalled();

		// Fast-forward timers
		jest.runAllTimers();

		// Now it should have been called
		expect(mockEditor.setLine).toHaveBeenCalled();
	});

	it('should skip insertion lines when results array is shorter (partial evaluation)', () => {
		// Simulates when evaluation stopped early due to error
		// If we have 5 lines with insertions at [0, 2, 4] but evaluation fails at line 2,
		// results will only have [result0, result1] (2 items)
		const results = [100, 200]; // Only 2 results
		const insertionLines = [0, 1, 4]; // 3 insertion line indices, but only 0 and 1 have results

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine
			.mockReturnValueOnce('@[result1]') // insertionLines[0] = 0 - has result
			.mockReturnValueOnce('@[result2]'); // insertionLines[1] = 1 - has result
			// insertionLines[2] = 4 - no result at index 4 (would throw without guard)

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		// Should only process first 2 insertion lines (indices 0 and 1), skip index 4
		expect(mockEditor.setLine).toHaveBeenCalledTimes(2);
		expect(mockEditor.setLine).toHaveBeenNthCalledWith(1, 1, '@[result1::100]');
		expect(mockEditor.setLine).toHaveBeenNthCalledWith(2, 2, '@[result2::200]');
	});

	it('should skip insertion when result is undefined', () => {
		// Simulates when evaluation returns undefined for certain lines (e.g., comments)
		const results = [100, undefined, 300];
		const insertionLines = [0, 1, 2];

		mockCtx.getSectionInfo.mockReturnValue({ lineStart: 0 });
		mockEditor.getLine
			.mockReturnValueOnce('@[result1]')
			.mockReturnValueOnce('@[result3]');

		handleResultInsertions(
			results,
			insertionLines,
			numberFormat,
			mockCtx as unknown as MarkdownPostProcessorContext,
			mockApp as App,
			mockEl
		);

		jest.runAllTimers();

		// Should skip the undefined result at index 1
		expect(mockEditor.setLine).toHaveBeenCalledTimes(2);
		expect(mockEditor.setLine).toHaveBeenNthCalledWith(1, 1, '@[result1::100]');
		expect(mockEditor.setLine).toHaveBeenNthCalledWith(2, 3, '@[result3::300]');
	});
});
