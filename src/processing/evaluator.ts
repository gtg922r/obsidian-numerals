import type { MathJsInstance, MathType } from 'mathjs';
import { CrossNoteResolutionResult } from './crossNoteResolver';
import { createReferenceScope, evaluateWithReferences, restoreReferenceNames, mapExpressionDiagnostic } from './referenceBindings';
import { scanExpression, MappedSource } from './expressionScanner';
import { getMathRuntime } from '../mathRuntime';
import { NumeralsScope, NumeralsError } from '../numerals.types';

/** Optional session integration. Legacy callers retain their existing scope behavior. */
export interface BlockEvaluationOptions {
	readonly runtime?: MathJsInstance;
	/** Exact indexed physical rows, including a final blank body row. */
	readonly physicalRowCount?: number;
	readonly onReferenceRead?: (name: string, value: unknown) => void;
	readonly beginRow?: (index: number, source: string) => void;
	readonly borrow?: (name: '__prev' | '__total', value: unknown, contributors: readonly number[]) => void;
	readonly commitRow?: (index: number, result: unknown) => void;
	readonly discardRow?: (index: number) => void;
	/** Private payload ownership, separate from the displayed copy. */
	readonly copyValue?: (value: unknown) => unknown;
	/** Runs after binding commit; presentation capture must handle its own errors. */
	readonly recordResult?: (index: number, result: unknown, transparent: boolean) => unknown;
}

/** Evaluate physical rows through the existing mathjs/reference pipeline. */
export function evaluateMathFromSourceStrings(
	processedSource: string,
	scope: NumeralsScope,
	transparentLineIndexes: readonly number[] = [],
	context?: { originalRows: readonly string[]; resolution: CrossNoteResolutionResult; sourceMap?: MappedSource },
	options: BlockEvaluationOptions = {},
): { results: unknown[]; inputs: string[]; errorMsg: Error | null; errorInput: string } {
	const runtime = options.runtime ?? getMathRuntime();
	const copy = options.copyValue ?? ((value: unknown) => value);
	const borrow = options.borrow ?? ((name: string, value: unknown) => { scope.set(name, value); });
	let errorMsg: Error | null = null;
	let errorInput = '';
	let evaluationScope: NumeralsScope;
	try {
		evaluationScope = createReferenceScope(scope, context?.resolution.bindings ?? new Map(), {
			runtime, onRead: options.onReferenceRead,
		});
	} catch (error: unknown) {
		return { results: [], inputs: [], errorMsg: asError(error), errorInput: context?.originalRows[0] ?? processedSource.split('\n')[0] };
	}
	const rows = processedSource.split('\n');
	const rowsToProcess = options.physicalRowCount === undefined
		? (rows[rows.length - 1] === '' ? rows.slice(0, -1) : rows)
		: rows.slice(0, options.physicalRowCount);
	const results: unknown[] = [];
	const inputs: string[] = [];
	const transparentLines = new Set(transparentLineIndexes);
	const segment: { value: unknown; index: number }[] = [];
	let previous: { value: unknown; index: number } | undefined;

	for (const [index, row] of rowsToProcess.entries()) {
		const displayInput = restoreReferenceNames(row, context?.resolution.bindingNames ?? new Map());
		if (transparentLines.has(index)) {
			results.push(options.recordResult?.(index, undefined, true));
			inputs.push(displayInput);
			continue;
		}
		let committed = false;
		let started = false;
		try {
			options.beginRow?.(index, row);
			started = true;
			const failure = context?.resolution.dependencies.find(dependency => dependency.error &&
				context.resolution.sourceMap.originalSource.slice(0, dependency.start).split('\n').length - 1 === index);
			if (failure) throw new NumeralsError('Note Reference Error', failure.error!);
			const tokens = scanExpression(row);
			const uses = (name: string) => tokens.some(token => token.kind === 'identifier' && token.text === name);
			borrow('__prev', previous ? copy(previous.value) : undefined, previous ? [previous.index] : []);
			if (!previous && uses('__prev')) {
				throw new NumeralsError('Previous Value Error', 'Error evaluating @prev directive. There is no previous result.');
			}
			let total: unknown;
			if (segment.length > 1) {
				try {
					// eslint-disable-next-line prefer-spread -- mathjs's variadic add requires at least two typed operands
					total = runtime.add.apply(runtime, segment.map(item => copy(item.value)) as [MathType, MathType, ...MathType[]]);
				} catch {
					if (uses('__total')) throw new NumeralsError('Summing Error', 'Error evaluating @sum or @total directive. Previous lines may not be summable.');
				}
			} else if (segment.length === 1) total = copy(segment[0].value);
			borrow('__total', total, segment.map(item => item.index));
			const result = evaluateWithReferences(row, evaluationScope, context?.resolution.bindings, runtime);
			options.commitRow?.(index, result);
			committed = true;
			results.push(options.recordResult ? options.recordResult(index, result, false) : result);
			inputs.push(displayInput);
			previous = { value: copy(result), index };
			if (result === undefined) segment.length = 0;
			else segment.push({ value: copy(result), index });
		} catch (error: unknown) {
			if (started && !committed) options.discardRow?.(index);
			errorMsg = asError(error);
			if (context?.sourceMap) {
				const generatedBase = rows.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
				const originalBase = context.originalRows.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
				errorMsg.message = mapExpressionDiagnostic(errorMsg.message, context.sourceMap, generatedBase, originalBase).message;
			}
			errorMsg.message = restoreReferenceNames(errorMsg.message, context?.resolution.bindingNames ?? new Map());
			errorInput = context?.originalRows[index] ?? row;
			break;
		}
	}
	return { results, inputs, errorMsg, errorInput };
}

function asError(error: unknown): Error {
	const copy = new Error(error instanceof Error ? error.message : String(error));
	if (error instanceof Error) copy.name = error.name;
	return copy;
}
