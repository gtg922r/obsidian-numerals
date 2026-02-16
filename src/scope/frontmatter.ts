import * as math from "mathjs";
import { getAPI } from "obsidian-dataview";
import { App, TFile } from "obsidian";
import { replaceStringsInTextFromMap } from "../processing/preprocessor";
import {
	FrontmatterProcessingWarning,
	NumeralsScope,
	StringReplaceMap,
} from "../numerals.types";

export interface FrontmatterScopeResult {
	scope: NumeralsScope;
	warnings: FrontmatterProcessingWarning[];
}

function toWarning(
	key: string,
	value: unknown,
	error: unknown
): FrontmatterProcessingWarning {
	const message = error instanceof Error ? error.message : String(error);
	return { key, value, message };
}

function evaluateFrontmatterExpression(
	key: string,
	processedValue: string,
	scope: NumeralsScope
): void {
	const functionAssignmentMatch = key.match(/^([^(]+)\(([^)]*)\)$/);
	if (functionAssignmentMatch) {
		const functionName = functionAssignmentMatch[1];
		const parameters = functionAssignmentMatch[2];
		const fullExpression = `${functionName}(${parameters}) = ${processedValue}`;
		const evaluatedFunction = math.evaluate(fullExpression, scope);
		scope.set(functionName, evaluatedFunction);
		return;
	}

	const evaluatedValue = math.evaluate(processedValue, scope);
	scope.set(key, evaluatedValue);
}

/**
 * Process frontmatter and return updated scope and warnings.
 * - Numbers are converted to mathjs numbers. Strings are processed as mathjs expressions.
 * - Objects are ignored.
 * - Frontmatter key `numerals` sets which frontmatter keys are processed.
 */
export function getScopeFromFrontmatterWithWarnings(
	frontmatter: { [key: string]: unknown } | undefined,
	scope: NumeralsScope | undefined,
	forceAll = false,
	stringReplaceMap: StringReplaceMap[] = [],
	keysOnly = false
): FrontmatterScopeResult {
	const warnings: FrontmatterProcessingWarning[] = [];
	let workingScope = scope ?? new NumeralsScope();

	if (!frontmatter || typeof frontmatter !== "object") {
		return { scope: workingScope, warnings };
	}

	let frontmatterProcess: { [key: string]: unknown } = {};

	if (Object.prototype.hasOwnProperty.call(frontmatter, "numerals")) {
		if (frontmatter.numerals === "none") {
			frontmatterProcess = {};
		} else if (frontmatter.numerals === "all") {
			for (const [key, value] of Object.entries(frontmatter)) {
				if (key !== "numerals") {
					frontmatterProcess[key] = value;
				}
			}
		} else if (typeof frontmatter.numerals === "string") {
			if (Object.prototype.hasOwnProperty.call(frontmatter, frontmatter.numerals)) {
				frontmatterProcess[frontmatter.numerals] = frontmatter[frontmatter.numerals];
			}
		} else if (Array.isArray(frontmatter.numerals)) {
			for (const key of frontmatter.numerals) {
				if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
					frontmatterProcess[key] = frontmatter[key];
				}
			}
		}
	} else if (forceAll) {
		frontmatterProcess = frontmatter;
	}

	for (const [key, value] of Object.entries(frontmatter)) {
		if (key.startsWith("$")) {
			frontmatterProcess[key] = value;
		}
	}

	if (keysOnly) {
		for (const key of Object.keys(frontmatterProcess)) {
			workingScope.set(key, undefined);
		}
		return { scope: workingScope, warnings };
	}

	const pendingStringExpressions: Map<string, string> = new Map();
	const pendingRawValues: Map<string, unknown> = new Map();

	for (const [key, rawValue] of Object.entries(frontmatterProcess)) {
		let value = rawValue;
		value = math.isUnit(value) ? value.valueOf() : value;
		if (Array.isArray(value)) {
			value = value[value.length - 1];
		}

		if (typeof value === "number") {
			workingScope.set(key, math.number(value));
		} else if (typeof value === "string") {
			pendingStringExpressions.set(
				key,
				replaceStringsInTextFromMap(value, stringReplaceMap)
			);
			pendingRawValues.set(key, rawValue);
		} else if (typeof value === "function") {
			workingScope.set(key, value);
		} else if (value !== null && typeof value === "object") {
			warnings.push(
				toWarning(
					key,
					rawValue,
					"Object-like frontmatter values are ignored. Quote the value to treat it as text."
				)
			);
		}
	}

	// Multi-pass evaluation allows references across multiple frontmatter expressions.
	let hasProgress = true;
	while (pendingStringExpressions.size > 0 && hasProgress) {
		hasProgress = false;

		for (const [key, expression] of pendingStringExpressions.entries()) {
			try {
				evaluateFrontmatterExpression(key, expression, workingScope);
				pendingStringExpressions.delete(key);
				pendingRawValues.delete(key);
				hasProgress = true;
			} catch (_error) {
				// Keep pending and retry after additional symbols become available.
			}
		}
	}

	for (const [key, expression] of pendingStringExpressions.entries()) {
		try {
			evaluateFrontmatterExpression(key, expression, workingScope);
		} catch (error) {
			warnings.push(toWarning(key, pendingRawValues.get(key), error));
		}
	}

	return { scope: workingScope, warnings };
}

/**
 * Backward-compatible helper preserving existing return type.
 */
export function getScopeFromFrontmatter(
	frontmatter: { [key: string]: unknown } | undefined,
	scope: NumeralsScope | undefined,
	forceAll = false,
	stringReplaceMap: StringReplaceMap[] = [],
	keysOnly = false
): NumeralsScope {
	const result = getScopeFromFrontmatterWithWarnings(
		frontmatter,
		scope,
		forceAll,
		stringReplaceMap,
		keysOnly
	);

	for (const warning of result.warnings) {
		console.error(`Error evaluating frontmatter value for key ${warning.key}: ${warning.message}`);
	}

	return result.scope;
}

/**
 * Retrieves metadata for a file at the specified path.
 */
export function getMetadataForFileAtPath(
	sourcePath: string,
	app: App,
	scopeCache: Map<string, NumeralsScope>
): { [key: string]: unknown } | undefined {
	const handle = app.vault.getAbstractFileByPath(sourcePath);
	const fileHandle = handle instanceof TFile ? handle : undefined;
	const fileCache = fileHandle ? app.metadataCache.getFileCache(fileHandle) : undefined;
	const frontmatter: { [key: string]: unknown } | undefined = {
		...(fileCache?.frontmatter),
		position: undefined,
	};

	const dataviewAPI = getAPI();
	let dataviewMetadata: { [key: string]: unknown } | undefined;
	if (dataviewAPI) {
		const dataviewPage = dataviewAPI.page(sourcePath);
		dataviewMetadata = { ...dataviewPage, file: undefined, position: undefined };
	}

	const numeralsPageScope = scopeCache.get(sourcePath);
	const numeralsPageScopeMetadata: { [key: string]: unknown } = numeralsPageScope
		? Object.fromEntries(numeralsPageScope)
		: {};

	return { ...frontmatter, ...dataviewMetadata, ...numeralsPageScopeMetadata };
}
