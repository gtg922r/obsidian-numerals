import { App, TFile } from 'obsidian';
import * as math from 'mathjs';
import { NumeralsSettings, StringReplaceMap } from '../numerals.types';
import { replaceStringsInTextFromMap } from './preprocessor';
import { getScopeFromFrontmatter, removeCanonicalizedDuplicates } from './scope';
import { getDataviewApi } from '../dataview';

/**
 * Result of resolving cross-note references in a source string.
 */
export interface CrossNoteResolutionResult {
	/** Source string with all [[note]].prop references replaced with resolved values */
	resolvedSource: string;
	/** File paths of all referenced notes (for re-render tracking) */
	referencedPaths: string[];
	/** Warnings generated during resolution (non-fatal issues) */
	warnings: string[];
	/** Fatal error if a reference couldn't be resolved (stops evaluation) */
	error: string | null;
}

/**
 * Parsed cross-note reference extracted from source text.
 */
export interface CrossNoteReference {
	/** The full matched text, e.g. `[[my note]].price.hourly` */
	fullMatch: string;
	/** The note name inside the brackets, e.g. `my note` */
	noteName: string;
	/** The property path after the dot, e.g. `price.hourly` */
	propertyPath: string;
}

/**
 * Regex pattern for matching cross-note references.
 *
 * Matches: `[[note name]].property` or `[[note name]].property.sub`
 * Does NOT match: `[[x]]` (no dot), `[[x]] .y` (space before dot)
 *
 * The property path supports alphanumeric characters, underscores, `$`, and
 * Unicode letters (to match mathjs variable naming rules).
 */
export const CROSS_NOTE_REF_REGEX = /\[\[([^\]]+)\]\]\.([$\w\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F]+(?:\.[$\w\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F]+)*)/g;

/**
 * Parse all cross-note references from a source string.
 *
 * @param source - The source string to scan
 * @returns Array of parsed cross-note references
 */
export function parseCrossNoteReferences(source: string): CrossNoteReference[] {
	const refs: CrossNoteReference[] = [];
	let match: RegExpExecArray | null;

	// Reset lastIndex for global regex
	CROSS_NOTE_REF_REGEX.lastIndex = 0;

	while ((match = CROSS_NOTE_REF_REGEX.exec(source)) !== null) {
		refs.push({
			fullMatch: match[0],
			noteName: match[1],
			propertyPath: match[2],
		});
	}

	return refs;
}

/**
 * Retrieve a value from a nested object using a dot-separated property path.
 *
 * @param obj - The object to traverse
 * @param path - Dot-separated property path (e.g. "rates.hourly")
 * @returns The value at the path, or undefined if not found
 */
export function getNestedProperty(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split('.');
	let current: unknown = obj;

	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== 'object') {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}

/**
 * Get metadata for a referenced note.
 *
 * Combines frontmatter and Dataview metadata (if available), respecting
 * the `numerals` frontmatter key on the referenced note to control which
 * properties are available.
 *
 * @param file - The TFile to get metadata for
 * @param app - The Obsidian App instance
 * @returns Combined metadata object, or undefined if no metadata
 */
export function getMetadataForReferencedNote(
	file: TFile,
	app: App,
): Record<string, unknown> | undefined {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter: Record<string, unknown> = { ...(cache?.frontmatter), position: undefined };

	const dataviewAPI = getDataviewApi(app);
	let dataviewMetadata: Record<string, unknown> | undefined;
	if (dataviewAPI) {
		const dataviewPage = dataviewAPI.page(file.path);
		if (dataviewPage) {
			dataviewMetadata = { ...dataviewPage, file: undefined, position: undefined };
		}
	}

	const cleanedDataview = dataviewMetadata ? removeCanonicalizedDuplicates(dataviewMetadata) : undefined;
	const metadata = { ...frontmatter, ...cleanedDataview };
	return metadata;
}

/**
 * Determine which properties from a note's metadata are available for
 * cross-note references, respecting the `numerals` frontmatter key.
 *
 * Rules (same as local frontmatter, plus always allowing `$`-prefixed keys):
 * - `numerals: none` → only `$`-prefixed keys
 * - `numerals: all` → all keys
 * - `numerals: keyName` → that key + `$`-prefixed keys
 * - `numerals: [key1, key2]` → those keys + `$`-prefixed keys
 * - No `numerals` key + forceAll=false → only `$`-prefixed keys
 * - No `numerals` key + forceAll=true → all keys
 *
 * @param metadata - Full metadata from the referenced note
 * @param forceAll - Whether to force processing all properties
 * @returns Filtered metadata with only available properties
 */
export function filterAvailableProperties(
	metadata: Record<string, unknown>,
	forceAll: boolean,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	// Determine which keys to include based on `numerals` setting
	const numeralsSetting = metadata['numerals'];

	if (numeralsSetting === 'none') {
		// Only $-prefixed keys
	} else if (numeralsSetting === 'all' || (numeralsSetting === undefined && forceAll)) {
		for (const [key, value] of Object.entries(metadata)) {
			if (key !== 'numerals') {
				result[key] = value;
			}
		}
	} else if (typeof numeralsSetting === 'string') {
		if (metadata.hasOwnProperty(numeralsSetting)) {
			result[numeralsSetting] = metadata[numeralsSetting];
		}
	} else if (Array.isArray(numeralsSetting)) {
		for (const entry of numeralsSetting as unknown[]) {
			const key = String(entry);
			if (metadata.hasOwnProperty(key)) {
				result[key] = metadata[key];
			}
		}
	}

	// Always include $-prefixed keys
	for (const [key, value] of Object.entries(metadata)) {
		if (key.startsWith('$')) {
			result[key] = value;
		}
	}

	return result;
}

/**
 * Evaluate a raw metadata value into a mathjs-compatible value.
 *
 * Handles the same types as getScopeFromFrontmatter:
 * - Numbers → mathjs numbers
 * - Strings → evaluated as mathjs expressions
 * - Arrays → last element used
 * - Objects → returned as-is (for nested property access)
 *
 * @param value - Raw metadata value
 * @param preProcessors - String replacement maps (currency, thousands, etc.)
 * @returns The evaluated value, or undefined if evaluation fails
 */
export function evaluateMetadataValue(
	value: unknown,
	preProcessors: StringReplaceMap[],
): { result: unknown; error?: string } {
	// Arrays: take last element (Dataview inline fields can produce arrays)
	if (Array.isArray(value)) {
		value = value[value.length - 1];
	}

	if (value === undefined || value === null) {
		return { result: undefined, error: 'Value is undefined' };
	}

	if (typeof value === 'number') {
		return { result: math.number(value) };
	}

	if (typeof value === 'object') {
		// Return objects as-is for nested property access
		return { result: value };
	}

	if (typeof value === 'string') {
		const processed = replaceStringsInTextFromMap(value, preProcessors);
		try {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- mathjs evaluate() returns any
			const evaluated = math.evaluate(processed);
			return { result: evaluated };
		} catch (e: unknown) {
			return { result: undefined, error: e instanceof Error ? e.message : String(e) };
		}
	}

	return { result: value };
}

/**
 * Resolve a single cross-note reference to its value.
 *
 * @param ref - The parsed cross-note reference
 * @param app - The Obsidian App instance
 * @param sourcePath - Path of the file containing the reference (for link resolution)
 * @param settings - Numerals settings
 * @param preProcessors - String replacement maps
 * @returns Object with the formatted value string, or an error
 */
export function resolveSingleReference(
	ref: CrossNoteReference,
	app: App,
	sourcePath: string,
	settings: NumeralsSettings,
	preProcessors: StringReplaceMap[],
): { value: string; referencedPath: string; warning?: string; error?: string } {
	// Resolve the note
	const file = app.metadataCache.getFirstLinkpathDest(ref.noteName, sourcePath);
	if (!file) {
		return {
			value: '',
			referencedPath: '',
			error: `Note "${ref.noteName}" not found in vault`,
		};
	}

	// Get metadata
	const metadata = getMetadataForReferencedNote(file, app);
	if (!metadata) {
		return {
			value: '',
			referencedPath: file.path,
			error: `No metadata found in "${ref.noteName}"`,
		};
	}

	// Filter to available properties
	const available = filterAvailableProperties(metadata, settings.forceProcessAllFrontmatter);

	// Get the property value (supports nested paths)
	const pathParts = ref.propertyPath.split('.');
	const topLevelKey = pathParts[0];

	if (!(topLevelKey in available)) {
		return {
			value: '',
			referencedPath: file.path,
			error: `Property "${topLevelKey}" not available in "${ref.noteName}". `
				+ `Ensure the property exists and is exposed via the \`numerals\` frontmatter key or starts with \`$\`.`,
		};
	}

	// For simple (non-nested) access, evaluate the top-level value directly
	if (pathParts.length === 1) {
		const rawValue = available[topLevelKey];
		const { scope } = getScopeFromFrontmatter(
			available,
			undefined,
			true,
			preProcessors,
		);

		if (scope.has(topLevelKey)) {
			const formatted = formatValueForInsertion(scope.get(topLevelKey));
			return { value: formatted, referencedPath: file.path };
		}

		const { result, error } = evaluateMetadataValue(rawValue, preProcessors);

		if (result === undefined || error) {
			return {
				value: '',
				referencedPath: file.path,
				warning: `Could not evaluate "${ref.propertyPath}" from "${ref.noteName}": ${error ?? 'undefined value'}`,
			};
		}

		// Format result back to a string that mathjs can parse
		const formatted = formatValueForInsertion(result);
		return { value: formatted, referencedPath: file.path };
	}

	// For nested access: first evaluate the top-level value, then traverse
	const topValue = available[topLevelKey];

	if (typeof topValue === 'object' && topValue !== null && !Array.isArray(topValue)) {
		const nestedPath = pathParts.slice(1).join('.');
		const nestedValue = getNestedProperty(topValue as Record<string, unknown>, nestedPath);

		if (nestedValue === undefined) {
			return {
				value: '',
				referencedPath: file.path,
				error: `Property "${ref.propertyPath}" not found in "${ref.noteName}"`,
			};
		}

		const { result, error } = evaluateMetadataValue(nestedValue, preProcessors);
		if (result === undefined || error) {
			return {
				value: '',
				referencedPath: file.path,
				warning: `Could not evaluate "${ref.propertyPath}" from "${ref.noteName}": ${error ?? 'undefined value'}`,
			};
		}

		const formatted = formatValueForInsertion(result);
		return { value: formatted, referencedPath: file.path };
	}

	// Top-level value is not an object but nested access was attempted
	return {
		value: '',
		referencedPath: file.path,
		error: `Property "${topLevelKey}" in "${ref.noteName}" is not an object; cannot access "${ref.propertyPath}"`,
	};
}

/**
 * Format a resolved value into a string suitable for insertion into a mathjs expression.
 *
 * Numbers, units, and other mathjs types use `math.format()` to produce
 * a parseable string. Strings are inserted as-is (they may contain expressions).
 *
 * @param value - The evaluated value to format
 * @returns A string representation suitable for mathjs parsing
 */
export function formatValueForInsertion(value: unknown): string {
	if (typeof value === 'number') {
		return String(value);
	}

	if (typeof value === 'string') {
		return value;
	}

	// mathjs types (units, BigNumber, Complex, etc.)
	try {
		return math.format(value, { notation: 'fixed' });
	} catch {
		return String(value);
	}
}

/**
 * Resolve all cross-note references in a source string.
 *
 * Scans the source for `[[note]].property` patterns, resolves each one
 * to its value from the referenced note's metadata, and substitutes the
 * value back into the source string.
 *
 * This should be called as the FIRST preprocessing step, before currency
 * and other preprocessors, because resolved values may contain currency
 * symbols or other patterns that need further preprocessing.
 *
 * @param source - The source string (may be multi-line)
 * @param app - The Obsidian App instance
 * @param sourcePath - Path of the current file (for link resolution)
 * @param settings - Numerals settings
 * @param preProcessors - String replacement maps for value evaluation
 * @returns Resolution result with substituted source and metadata
 */
export function resolveCrossNoteReferences(
	source: string,
	app: App,
	sourcePath: string,
	settings: NumeralsSettings,
	preProcessors: StringReplaceMap[],
): CrossNoteResolutionResult {
	if (!settings.enableCrossNoteReferences) {
		return {
			resolvedSource: source,
			referencedPaths: [],
			warnings: [],
			error: null,
		};
	}

	const refs = parseCrossNoteReferences(source);
	if (refs.length === 0) {
		return {
			resolvedSource: source,
			referencedPaths: [],
			warnings: [],
			error: null,
		};
	}

	let resolvedSource = source;
	const referencedPaths: string[] = [];
	const warnings: string[] = [];

	for (const ref of refs) {
		const result = resolveSingleReference(ref, app, sourcePath, settings, preProcessors);

		if (result.referencedPath && !referencedPaths.includes(result.referencedPath)) {
			referencedPaths.push(result.referencedPath);
		}

		if (result.error) {
			return {
				resolvedSource,
				referencedPaths,
				warnings,
				error: result.error,
			};
		}

		if (result.warning) {
			warnings.push(result.warning);
		}

		// Replace the reference with the resolved value
		// Use a literal string replacement (not regex) to avoid issues with special chars
		resolvedSource = resolvedSource.replace(ref.fullMatch, result.value);
	}

	return {
		resolvedSource,
		referencedPaths,
		warnings,
		error: null,
	};
}
