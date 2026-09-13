import { originalSource } from '../src/processing/expressionScanner';
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
	NumeralsNumberFormat,
	NumeralsSettings,
	DEFAULT_SETTINGS,
	numeralsBlockInfo,
} from '../src/numerals.types';
import {
	createNumberFormatProfile,
	createResultFormatter,
} from '../src/formatting';

const formatter = createResultFormatter({
	profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
});

describe('Rendering Pipeline Types', () => {
	describe('ProcessedBlock', () => {
		it('should accept valid ProcessedBlock structure', () => {
			const processedBlock: ProcessedBlock = {
				rawRows: ['line1', 'line2'],
				processedSource: 'processed\nsource',
				sourceMap: originalSource(''),
			transparentLineIndexes: [],
				blockInfo: {
					emitter_lines: [1],
					insertion_lines: [],
					hidden_lines: [],
					shouldHideNonEmitterLines: false,
				},
				formatOverrides: {},
				invalidFormatDirectives: [],
			};

			expect(processedBlock.rawRows).toHaveLength(2);
			expect(processedBlock.processedSource).toContain('processed');
			expect(processedBlock.blockInfo.emitter_lines).toEqual([1]);
		});

		it('should handle empty arrays in blockInfo', () => {
			const processedBlock: ProcessedBlock = {
				rawRows: [],
				processedSource: '',
				sourceMap: originalSource(''),
			transparentLineIndexes: [],
				blockInfo: {
					emitter_lines: [],
					insertion_lines: [],
					hidden_lines: [],
					shouldHideNonEmitterLines: false,
				},
				formatOverrides: {},
				invalidFormatDirectives: [],
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

	it('keeps renderer contracts data-only with an explicit projection lifetime', () => {
  const data: LineRenderData = {index: 0, rawInput: '2 + 2', processedInput: '2 + 2',
   formattedResult: {text: '4', tex: '4', canonical: '4'}, inputTeX: '2+2',
   isEmpty: false, isEmitter: false, isHidden: false, comment: null};
  const context: RenderContext = {renderStyle: NumeralsRenderStyle.Plain, settings: DEFAULT_SETTINGS, signal: new AbortController().signal};
  expect(data.formattedResult?.text).toBe('4');
  expect(context.signal.aborted).toBe(false);
  // @ts-expect-error Raw evaluated objects are not accepted by renderer strategies.
  const raw: LineRenderData = {...data, result: new Map()};
  expect('result' in raw).toBe(true);
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
			sourceMap: originalSource(''),
			transparentLineIndexes: [],
			blockInfo,
			formatOverrides: {},
			invalidFormatDirectives: [],
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
