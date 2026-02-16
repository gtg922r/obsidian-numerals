import * as math from 'mathjs';
import { NumeralsScope, NumeralsError, EvaluationResult } from '../numerals.types';

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
	scope: NumeralsScope
): {
	results: unknown[];
	inputs: string[];
	errorMsg: Error | null;
	errorInput: string;
} {
	let errorMsg = null;
	let errorInput = "";

	const rows: string[] = processedSource.split("\n");
	const results: unknown[] = [];
	const inputs: string[] = [];

	// Last row is empty in reader view, so ignore it if empty
	const isLastRowEmpty = rows.slice(-1)[0] === "";
	const rowsToProcess = isLastRowEmpty ? rows.slice(0, -1) : rows;

	for (const [index, row] of rowsToProcess.entries()) {
		const lastUndefinedRowIndex = results.slice(0, index).lastIndexOf(undefined);

		try {
			if (index > 0 && results.length > 0) {
				const prevResult = results[results.length - 1];
				scope.set("__prev", prevResult);
			} else {
				scope.set("__prev", undefined);
				if (/__prev/i.test(row)) {
					errorMsg = new NumeralsError("Previous Value Error", 'Error evaluating @prev directive. There is no previous result.');
					errorInput = row;
					break;
				}
			}
			
			const partialResults = results.slice(lastUndefinedRowIndex+1, index).filter(result => result !== undefined);
			if (partialResults.length > 1) {
				try {
					// eslint-disable-next-line prefer-spread
					const rollingSum = math.add.apply(math, partialResults as [math.MathType, math.MathType, ...math.MathType[]]);
					scope.set("__total", rollingSum);
				} catch (error) {
					scope.set("__total", undefined);
					// TODO consider doing this check before evaluating
					if (/__total/i.test(row)) {
						errorMsg = new NumeralsError("Summing Error", 'Error evaluating @sum or @total directive. Previous lines may not be summable.');
						errorInput = row;
						break;
					}						
				}

			} else if (partialResults.length === 1) {
				scope.set("__total", partialResults[0]);
			} else {
				scope.set("__total", undefined);
			}
			results.push(math.evaluate(row, scope));
			inputs.push(row); // Only pushes if evaluate is successful
		} catch (error: unknown) {
			errorMsg = error instanceof Error ? error : new Error(String(error));
			errorInput = row;
			break;
		}
	}

	return { results, inputs, errorMsg, errorInput };
}
