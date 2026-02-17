import * as math from 'mathjs';
import { getAPI } from 'obsidian-dataview';
import { App, TFile } from 'obsidian';
import { NumeralsScope, StringReplaceMap } from '../numerals.types';
import { replaceStringsInTextFromMap } from './preprocessor';

/**
 * Process frontmatter and return updated scope object
 * - Numbers are converted to mathjs numbers. Strings are processed as mathjs expressions.
 * - Objects are ignored
 * - Frontmatter key `numerals` sets which frontmatter keys are processed (none is default)):
 *  - `numerals: all` processes all frontmatter keys
 *  - `numerals: none` processes no frontmatter keys
 *  - `numerals: key1` processes only the frontmatter key `key1`
 *  - `numerals: [key1, key2, ...]` processes only the listed frontmatter keys
 *  * 
 * @param scope Numerals scope object (Map)
 * @param frontmatter Frontmatter object
 * @returns Updated scope object
 */
export interface ScopeResult {
	scope: NumeralsScope;
	warnings: string[];
}

export function getScopeFromFrontmatter(
	frontmatter: { [key: string]: unknown } | undefined,
	scope: NumeralsScope|undefined,
	forceAll=false,
	stringReplaceMap: StringReplaceMap[] = [],
	keysOnly=false
): ScopeResult {
	const warnings: string[] = [];
	
	if (!scope) {
		scope = new NumeralsScope();
	}

	if (frontmatter && typeof frontmatter === "object") {
		let frontmatter_process:{ [key: string]: unknown } = {}

		// Determine which metadata keys to process
		if (frontmatter.hasOwnProperty("numerals")) {
			if (frontmatter["numerals"] === "none") {
				frontmatter_process = {};
			} else if (frontmatter.hasOwnProperty("numerals") && frontmatter["numerals"] === "all") {
				// Build frontmatter_process from all keys in frontmatter
				for (const [key, value] of Object.entries(frontmatter)) {
					if (key !== "numerals") {
						frontmatter_process[key] = value;
					}
				}
			} else if (typeof frontmatter["numerals"] === "string") {
				if (frontmatter.hasOwnProperty(frontmatter["numerals"])) {
					frontmatter_process[frontmatter["numerals"]] = frontmatter[frontmatter["numerals"]];
				}
			} else if (Array.isArray(frontmatter["numerals"])) {
				for (const key of frontmatter["numerals"]) {
					if (frontmatter.hasOwnProperty(key)) {
						frontmatter_process[key] = frontmatter[key];
					}
				}
			}
		} else if (forceAll) {
			frontmatter_process = frontmatter;
		}

		// Iterate through frontmatter and add any key/value pair to frontmatter_process if the key starts with `$`
		//   These keys are assumed to be numerals globals that are to be added to the scope regardless of the `numerals` key
		for (const [key, value] of Object.entries(frontmatter)) {
			if (key.startsWith('$')) {
				frontmatter_process[key] = value;
			}
		}

		// if keysOnly is true, only add keys to scope. Otherwise, add values to scope
		if (keysOnly === false) {
			for (const [key, rawValue] of Object.entries(frontmatter_process)) {
				let value = rawValue;
				
				// If value is a mathjs unit, convert to string representation
				value = math.isUnit(value) ? value.valueOf() : value;

				// if processedValue is array-like, take the last element. For inline dataview fields, this generally means the most recent line will be used
				if (Array.isArray(value)) {
					value = value[value.length - 1];
				}

				if (typeof value === "number") {
					scope.set(key, math.number(value));
				} else if (typeof value === "string") {
					const processedValue = replaceStringsInTextFromMap(value, stringReplaceMap);
					
					// Check if the key contains function assignment syntax (e.g., "$v(x)" or "f(x, y)")
					const functionAssignmentMatch = key.match(/^([^(]+)\(([^)]*)\)$/);
					
					if (functionAssignmentMatch) {
						// This is a function assignment like "$v(x)" with value "x + $b - $a"
						const functionName = functionAssignmentMatch[1];
						const parameters = functionAssignmentMatch[2];
						const fullExpression = `${functionName}(${parameters}) = ${processedValue}`;
						
						try {
							// Evaluate the complete function assignment expression
							const evaluatedFunction = math.evaluate(fullExpression, scope);
							// Store the function under the function name (without parentheses)
							scope.set(functionName, evaluatedFunction);
						} catch (error: unknown) {
							warnings.push(`Frontmatter: error evaluating function "${key}": ${error instanceof Error ? error.message : String(error)}`);
						}
					} else {
						// Regular variable assignment
						let evaluatedValue;
						try {
							evaluatedValue = math.evaluate(processedValue, scope);
						} catch (error: unknown) {
							warnings.push(`Frontmatter: error evaluating "${key}": ${error instanceof Error ? error.message : String(error)}`);
							evaluatedValue = undefined;
						}
						if (evaluatedValue !== undefined) {
							scope.set(key, evaluatedValue);
						}
					}
				} else if (typeof value === "function") {
					// Functions (like those cached from previous evaluations) should be stored directly
					scope.set(key, value);
				} else if (typeof value === "object") {
					warnings.push(`Frontmatter: value for "${key}" is an object and will be ignored. ` +
						`Consider surrounding the value with quotes (e.g. \`${key}: "value"\`).`);
				}
			}
		} else {
			for (const key of Object.keys(frontmatter_process)) {
				scope.set(key, undefined);
			}
		}

		return { scope, warnings };
	} else {
		return { scope, warnings };
	}
}	

/**
 * Remove keys from a metadata object that are Dataview-canonicalized duplicates
 * of other keys in the same object.
 *
 * Dataview normalizes property names by stripping characters outside
 * `[0-9\p{L}_-]` and lowercasing (see `canonicalizeVarName` in Dataview).
 * For keys like `f(x)` or `$g(x)`, this produces phantom keys (`fx`, `gx`)
 * that shadow the originals and cause evaluation errors.
 *
 * This function detects and removes those phantoms: a key is a phantom if
 * some *other* key in the object canonicalizes to it.
 */
export function removeCanonicalizedDuplicates(
	metadata: Record<string, unknown>
): Record<string, unknown> {
	const keys = Object.keys(metadata);
	// Mirrors Dataview's canonicalizeVarName: whitespace → '-', other
	// non-alphanumeric/non-underscore/non-dash characters are stripped, then lowercase.
	const canonicalize = (k: string) =>
		k.replace(/\s+/g, '-').replace(/[^0-9\p{L}_-]/gu, '').toLowerCase();

	// Build a set of canonicalized forms of keys that differ from their canonical form
	const phantomNames = new Set<string>();
	for (const key of keys) {
		const canon = canonicalize(key);
		if (canon !== key) {
			phantomNames.add(canon);
		}
	}

	if (phantomNames.size === 0) return metadata;

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (!phantomNames.has(key)) {
			result[key] = value;
		}
	}
	return result;
}

/** 
 * Add globals from a scope to the Numerals page cache
 * 
 * Globals are keys in the scope Map that start with `$`
 * @param sourcePath Path of the source file
 * @param scope Scope object
 * @returns void
 */
export function addGlobalsFromScopeToPageCache(sourcePath: string, scope: NumeralsScope, scopeCache: Map<string, NumeralsScope>) {
	for (const [key, value] of scope.entries()) {
		if (key.startsWith('$')) {
			if (scopeCache.has(sourcePath)) {
				scopeCache.get(sourcePath)?.set(key, value);
			} else {
				const newScope = new NumeralsScope();
				newScope.set(key, value);
				scopeCache.set(sourcePath, newScope);
			}
		}
	}
}

/**
 * Retrieves metadata for a file at the specified path.
 * 
 * This function takes a source path as input and retrieves the metadata associated with the file at that path. 
 * It first checks the metadata cache for the file and retrieves the frontmatter. 
 * If the file is a Dataview file, it also retrieves the Dataview metadata. 
 * The function then combines the frontmatter and Dataview metadata, with the Dataview metadata taking precedence.
 * 
 * @param sourcePath - The path of the file for which to retrieve metadata.
 * @param app - The Obsidian App instance.
 * @param scopeCache - A Map containing NumeralsScope objects for each file path.
 * @returns The metadata for the file, including both frontmatter and Dataview metadata.
 */
export function getMetadataForFileAtPath(
	sourcePath: string, 
	app: App,
	scopeCache: Map<string, NumeralsScope>
): {[key: string]: unknown} | undefined {
	const f_path:string = sourcePath;
	const handle = app.vault.getAbstractFileByPath(f_path);
	const f_handle = (handle instanceof TFile) ? handle : undefined;
	const f_cache = f_handle ? app.metadataCache.getFileCache(f_handle as TFile) : undefined;
	const frontmatter:{[key: string]: unknown} | undefined = {...(f_cache?.frontmatter), position: undefined};

	const dataviewAPI = getAPI();
	let dataviewMetadata:{[key: string]: unknown} | undefined;
	if (dataviewAPI) {
		const dataviewPage = dataviewAPI.page(f_path)
		dataviewMetadata = {...dataviewPage, file: undefined, position: undefined}
	}
 
	const numeralsPageScope = scopeCache.get(f_path);
	const numeralsPageScopeMetadata:{[key: string]: unknown} = numeralsPageScope ? Object.fromEntries(numeralsPageScope) : {};
  
	// combine frontmatter and dataview metadata, with dataview metadata taking precedence and numerals scope taking precedence over both
	// Remove phantom keys created by Dataview's key canonicalization (e.g. `f(x)` → `fx`)
	const cleanedDataview = dataviewMetadata ? removeCanonicalizedDuplicates(dataviewMetadata) : undefined;
	const metadata = {...frontmatter, ...cleanedDataview, ...numeralsPageScopeMetadata};		
	return metadata;
}
