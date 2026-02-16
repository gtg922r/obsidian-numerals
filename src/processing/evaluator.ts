import * as math from "mathjs";
import {
	PREVIOUS_VALUE_MAGIC_VARIABLE,
	ROLLING_TOTAL_MAGIC_VARIABLE,
} from "../constants";
import { EvaluationResult, NumeralsScope } from "../numerals.types";

function createNamedError(name: string, message: string): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}

/**
 * Evaluates a block of math expressions and returns results per row.
 */
export function evaluateMathFromSourceStrings(
	processedSource: string,
	scope: NumeralsScope
): EvaluationResult {
	let errorMsg: Error | null = null;
	let errorInput = "";

	const rows: string[] = processedSource.split("\n");
	const results: unknown[] = [];
	const inputs: string[] = [];

	const isLastRowEmpty = rows.slice(-1)[0] === "";
	const rowsToProcess = isLastRowEmpty ? rows.slice(0, -1) : rows;

	for (const [index, row] of rowsToProcess.entries()) {
		const lastUndefinedRowIndex = results.slice(0, index).lastIndexOf(undefined);

		try {
			if (index > 0 && results.length > 0) {
				const prevResult = results[results.length - 1];
				scope.set(PREVIOUS_VALUE_MAGIC_VARIABLE, prevResult);
			} else {
				scope.set(PREVIOUS_VALUE_MAGIC_VARIABLE, undefined);
				if (new RegExp(PREVIOUS_VALUE_MAGIC_VARIABLE, "i").test(row)) {
					errorMsg = createNamedError(
						"Previous Value Error",
						"Error evaluating @prev directive. There is no previous result."
					);
					errorInput = row;
					break;
				}
			}

			const partialResults = results
				.slice(lastUndefinedRowIndex + 1, index)
				.filter((result) => result !== undefined);

			if (partialResults.length > 1) {
				try {
					let rollingSum = partialResults[0] as math.MathType;
					for (const value of partialResults.slice(1)) {
						rollingSum = math.add(rollingSum, value as math.MathType);
					}
					scope.set(ROLLING_TOTAL_MAGIC_VARIABLE, rollingSum);
				} catch (_error) {
					scope.set(ROLLING_TOTAL_MAGIC_VARIABLE, undefined);
					if (new RegExp(ROLLING_TOTAL_MAGIC_VARIABLE, "i").test(row)) {
						errorMsg = createNamedError(
							"Summing Error",
							"Error evaluating @sum or @total directive. Previous lines may not be summable."
						);
						errorInput = row;
						break;
					}
				}
			} else if (partialResults.length === 1) {
				scope.set(ROLLING_TOTAL_MAGIC_VARIABLE, partialResults[0]);
			} else {
				scope.set(ROLLING_TOTAL_MAGIC_VARIABLE, undefined);
			}

			results.push(math.evaluate(row, scope));
			inputs.push(row);
		} catch (error: unknown) {
			errorMsg = error instanceof Error ? error : createNamedError("Evaluation Error", String(error));
			errorInput = row;
			break;
		}
	}

	return { results, inputs, errorMsg, errorInput };
}
