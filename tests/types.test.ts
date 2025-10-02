/**
 * Unit tests for new rendering pipeline types introduced in Phase 1 refactoring.
 * These tests verify type safety and ensure proper structure of DTOs.
 */

import {
	ProcessedBlock,
	EvaluationResult,
	LineRenderData,
	RenderContext,
	StringReplaceMap,
	NumeralsRenderStyle,
	NumeralsSettings,
	DEFAULT_SETTINGS,
	mathjsFormat,
	numeralsBlockInfo,
} from '../src/numerals.types';

describe('Rendering Pipeline Types', () => {
	describe('ProcessedBlock', () => {
		it('should accept valid ProcessedBlock structure', () => {
			const processedBlock: ProcessedBlock = {
				rawRows: ['line1', 'line2'],
				processedSource: 'processed\nsource',
				blockInfo: {
					emitter_lines: [1],
					insertion_lines: [],
					hidden_lines: [],
					shouldHideNonEmitterLines: false,
				},
			};

			expect(processedBlock.rawRows).toHaveLength(2);
			expect(processedBlock.processedSource).toContain('processed');
			expect(processedBlock.blockInfo.emitter_lines).toEqual([1]);
		});

		it('should handle empty arrays in blockInfo', () => {
			const processedBlock: ProcessedBlock = {
				rawRows: [],
				processedSource: '',
				blockInfo: {
					emitter_lines: [],
					insertion_lines: [],
					hidden_lines: [],
					shouldHideNonEmitterLines: false,
				},
			};

			expect(processedBlock.rawRows).toHaveLength(0);
			expect(processedBlock.blockInfo.emitter_lines).toHaveLength(0);
		});
	});

	describe('EvaluationResult', () => {
		it('should accept valid EvaluationResult with no errors', () => {
			const result: EvaluationResult = {
				results: [2, 4, 6],
				inputs: ['1+1', '2+2', '3+3'],
				errorMsg: null,
				errorInput: '',
			};

			expect(result.results).toHaveLength(3);
			expect(result.inputs).toHaveLength(3);
			expect(result.errorMsg).toBeNull();
		});

		it('should accept valid EvaluationResult with error', () => {
			const error = new Error('Syntax error');
			const result: EvaluationResult = {
				results: [2],
				inputs: ['1+1'],
				errorMsg: error,
				errorInput: '2+',
			};

			expect(result.errorMsg).toBe(error);
			expect(result.errorInput).toBe('2+');
		});

		it('should handle undefined results for empty lines', () => {
			const result: EvaluationResult = {
				results: [undefined, 2, undefined],
				inputs: ['', '1+1', '# comment'],
				errorMsg: null,
				errorInput: '',
			};

			expect(result.results[0]).toBeUndefined();
			expect(result.results[1]).toBe(2);
		});
	});

	describe('LineRenderData', () => {
		it('should accept valid LineRenderData for normal line', () => {
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

			expect(lineData.index).toBe(0);
			expect(lineData.result).toBe(4);
			expect(lineData.isEmpty).toBe(false);
		});

		it('should accept valid LineRenderData for empty line', () => {
			const lineData: LineRenderData = {
				index: 5,
				rawInput: '',
				processedInput: '',
				result: undefined,
				isEmpty: true,
				isEmitter: false,
				isHidden: false,
				comment: null,
			};

			expect(lineData.isEmpty).toBe(true);
			expect(lineData.result).toBeUndefined();
		});

		it('should accept valid LineRenderData with comment', () => {
			const lineData: LineRenderData = {
				index: 2,
				rawInput: '2 + 2 # this is a comment',
				processedInput: '2 + 2',
				result: 4,
				isEmpty: false,
				isEmitter: false,
				isHidden: false,
				comment: 'this is a comment',
			};

			expect(lineData.comment).toBe('this is a comment');
		});

		it('should accept valid LineRenderData for emitter line', () => {
			const lineData: LineRenderData = {
				index: 3,
				rawInput: 'result = 42 =>',
				processedInput: 'result = 42',
				result: 42,
				isEmpty: false,
				isEmitter: true,
				isHidden: false,
				comment: null,
			};

			expect(lineData.isEmitter).toBe(true);
			expect(lineData.result).toBe(42);
		});

		it('should accept valid LineRenderData for hidden line', () => {
			const lineData: LineRenderData = {
				index: 4,
				rawInput: 'intermediate = 10',
				processedInput: 'intermediate = 10',
				result: 10,
				isEmpty: false,
				isEmitter: false,
				isHidden: true,
				comment: null,
			};

			expect(lineData.isHidden).toBe(true);
		});
	});

	describe('RenderContext', () => {
		it('should accept valid RenderContext with Plain style', () => {
			const context: RenderContext = {
				renderStyle: NumeralsRenderStyle.Plain,
				settings: DEFAULT_SETTINGS,
				numberFormat: undefined,
				preProcessors: [],
			};

			expect(context.renderStyle).toBe(NumeralsRenderStyle.Plain);
			expect(context.settings).toBe(DEFAULT_SETTINGS);
		});

		it('should accept valid RenderContext with TeX style', () => {
			const context: RenderContext = {
				renderStyle: NumeralsRenderStyle.TeX,
				settings: DEFAULT_SETTINGS,
				numberFormat: { notation: 'fixed' },
				preProcessors: [],
			};

			expect(context.renderStyle).toBe(NumeralsRenderStyle.TeX);
			expect(context.numberFormat).toHaveProperty('notation', 'fixed');
		});

		it('should accept valid RenderContext with preProcessors', () => {
			const preProcessors: StringReplaceMap[] = [
				{ regex: /\$/g, replaceStr: 'USD' },
				{ regex: /,(\d{3})/g, replaceStr: '$1' },
			];

			const context: RenderContext = {
				renderStyle: NumeralsRenderStyle.SyntaxHighlight,
				settings: DEFAULT_SETTINGS,
				numberFormat: undefined,
				preProcessors,
			};

			expect(context.preProcessors).toHaveLength(2);
			expect(context.preProcessors[0].replaceStr).toBe('USD');
		});
	});

	describe('StringReplaceMap', () => {
		it('should accept valid StringReplaceMap', () => {
			const replaceMap: StringReplaceMap = {
				regex: /test/g,
				replaceStr: 'replacement',
			};

			expect(replaceMap.regex).toBeInstanceOf(RegExp);
			expect(replaceMap.replaceStr).toBe('replacement');
		});

		it('should allow complex regex patterns', () => {
			const replaceMap: StringReplaceMap = {
				regex: /\$([0-9,]+(\.[0-9]+)?)/g,
				replaceStr: '$1 USD',
			};

			const testString = '$100.50';
			const result = testString.replace(replaceMap.regex, replaceMap.replaceStr);
			expect(result).toBe('100.50 USD');
		});
	});
});

describe('Type Compatibility', () => {
	it('should allow ProcessedBlock to be created from existing code patterns', () => {
		// Simulate what preProcessBlockForNumeralsDirectives returns
		const rawRows = ['line1', 'line2', 'line3'];
		const processedSource = 'line1\nline2\nline3';
		const blockInfo: numeralsBlockInfo = {
			emitter_lines: [1],
			insertion_lines: [2],
			hidden_lines: [],
			shouldHideNonEmitterLines: false,
		};

		const processedBlock: ProcessedBlock = {
			rawRows,
			processedSource,
			blockInfo,
		};

		expect(processedBlock).toBeDefined();
	});

	it('should allow EvaluationResult to be created from existing code patterns', () => {
		// Simulate what evaluateMathFromSourceStrings returns
		const results = [1, 2, 3];
		const inputs = ['a=1', 'b=2', 'c=3'];
		const errorMsg = null;
		const errorInput = '';

		const evaluationResult: EvaluationResult = {
			results,
			inputs,
			errorMsg,
			errorInput,
		};

		expect(evaluationResult).toBeDefined();
	});
});
