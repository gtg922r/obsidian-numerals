import { CrossNoteResolutionResult } from './crossNoteResolver';
import { createReferenceScope, evaluateWithReferences, restoreReferenceNames, mapExpressionDiagnostic } from './referenceBindings';
import { scanExpression, MappedSource } from './expressionScanner';
import * as math from 'mathjs';
import { NumeralsScope, NumeralsError } from '../numerals.types';

/**
 * Evaluates a block of math expressions and returns the results. Each row is evaluated separately
 * and the results are returned in an array. If an error occurs, the error message and the input that
 * caused the error are returned.
 * 
 * @remarks
 * This function uses the mathjs library to evaluate the expressions. The scope parameter is used to
 * provide variables and functions that can be used in the expressions. The scope is a Map object
 * where the keys are the variable names and the values are the variable values.
 * 
 * All Numerals directive must be removed from the source before calling this function as it is processed
 * directly by mathjs.
 * 
 * @param processedSource The source string to evaluate
 * @param scope The scope object to use for the evaluation
 * @returns An object containing the results of the evaluation, the inputs that were evaluated, and
 * any error message and input that caused the error.
 */
export function evaluateMathFromSourceStrings(
	processedSource: string,
	scope: NumeralsScope,
	transparentLineIndexes: readonly number[] = [],
	context?: { originalRows: readonly string[]; resolution: CrossNoteResolutionResult; sourceMap?: MappedSource },
): {
	results: unknown[];
	inputs: string[];
	errorMsg: Error | null;
	errorInput: string;
} {
	let errorMsg = null;
	let errorInput = "";

	let evaluationScope: NumeralsScope;
	try { evaluationScope = createReferenceScope(scope, context?.resolution.bindings ?? new Map()); }
	catch (error: unknown) {
		return { results: [], inputs: [], errorMsg: error instanceof Error ? error : new Error(String(error)), errorInput: context?.originalRows[0] ?? processedSource.split('\n')[0] };
	}
	const rows: string[] = processedSource.split("\n");
	const results: unknown[] = [];
	const inputs: string[] = [];
	const transparentLines = new Set(transparentLineIndexes);
	const segmentResults: unknown[] = [];
	let hasPreviousEvaluation = false;
	let previousResult: unknown;

	// Last row is empty in reader view, so ignore it if empty
	const isLastRowEmpty = rows.slice(-1)[0] === "";
	const rowsToProcess = isLastRowEmpty ? rows.slice(0, -1) : rows;

	for (const [index, row] of rowsToProcess.entries()) {
		if (transparentLines.has(index)) {
			// Preserve source/result index alignment without allowing a display-only
			// directive row to change @prev or reset the current @total segment.
			results.push(undefined);
			inputs.push(restoreReferenceNames(row, context?.resolution.bindingNames ?? new Map()));
			continue;
		}

		try {
			const failure = context?.resolution.dependencies.find(d => d.error && context.resolution.sourceMap.originalSource.slice(0, d.start).split('\n').length - 1 === index);
			if (failure) throw new NumeralsError('Note Reference Error', failure.error!);
			if (hasPreviousEvaluation) {
				scope.set("__prev", previousResult);
			} else {
				scope.set("__prev", undefined);
				if (scanExpression(row).some(t => t.kind === 'identifier' && t.text === '__prev')) {
					errorMsg = new NumeralsError("Previous Value Error", 'Error evaluating @prev directive. There is no previous result.');
					errorInput = context?.originalRows[index] ?? row;
					break;
				}
			}
			
			if (segmentResults.length > 1) {
				try {
					// eslint-disable-next-line prefer-spread -- mathjs variadic add requires at least two typed operands
					const rollingSum = math.add.apply(math, segmentResults as [math.MathType, math.MathType, ...math.MathType[]]);
					scope.set("__total", rollingSum);
				} catch {
					scope.set("__total", undefined);
					// TODO consider doing this check before evaluating
					if (scanExpression(row).some(t => t.kind === 'identifier' && t.text === '__total')) {
						errorMsg = new NumeralsError("Summing Error", 'Error evaluating @sum or @total directive. Previous lines may not be summable.');
						errorInput = context?.originalRows[index] ?? row;
						break;
					}						
				}

			} else if (segmentResults.length === 1) {
				scope.set("__total", segmentResults[0]);
			} else {
				scope.set("__total", undefined);
			}

			const result = evaluateWithReferences(row, evaluationScope, context?.resolution.bindings);
			results.push(result);
			inputs.push(restoreReferenceNames(row, context?.resolution.bindingNames ?? new Map())); // Only pushes if evaluate is successful
			hasPreviousEvaluation = true;
			previousResult = result;
			if (result === undefined) {
				segmentResults.length = 0;
			} else {
				segmentResults.push(result);
			}
		} catch (error: unknown) {
			errorMsg = error instanceof Error ? error : new Error(String(error));
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
