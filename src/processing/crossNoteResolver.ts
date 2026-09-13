import { App, TFile } from 'obsidian';
import * as math from '../mathRuntime';
import { NumeralsSettings, StringReplaceMap } from '../numerals.types';
import { replaceStringsInTextFromMap } from './preprocessor';
import { getScopeFromFrontmatter, removeCanonicalizedDuplicates } from './scope';
import { getDataviewApi } from '../dataview';
import { applySourceEdits, originalSource, scanExpression, CROSS_NOTE_REF_REGEX, MappedSource, SourceSpan } from './expressionScanner';
import { cloneReferenceValue, restoreReferenceNames, mapExpressionDiagnostic } from './referenceBindings';
import { hasOwnProperty } from '../utils/hasOwnProperty';

export { CROSS_NOTE_REF_REGEX } from './expressionScanner';

export interface CrossNoteReference extends SourceSpan {
	fullMatch: string;
	noteName: string;
	propertyPath: string;
}

/** A dependency survives missing files, missing properties, and failed value evaluation. */
export interface ReferenceDependency extends CrossNoteReference {
	sourcePath: string;
	resolvedPath?: string;
	status: 'resolved' | 'missing-note' | 'unavailable-property' | 'invalid-value';
	error?: string;
}

export interface CrossNoteResolutionResult {
	/** Mathjs source containing opaque symbols; evaluate only with this binding table. */
	resolvedSource: string;
	sourceMap: MappedSource;
	bindings: ReadonlyMap<string, unknown>;
	bindingNames: ReadonlyMap<string, string>;
	referencedPaths: string[];
	dependencies: ReferenceDependency[];
	warnings: string[];
	error: string | null;
}

export class ReferenceEvaluationError extends Error {
	readonly referencedPaths: string[];
	readonly dependencies: ReferenceDependency[];
	readonly sourceSpan?: SourceSpan;
	constructor(message: string, readonly resolution: CrossNoteResolutionResult, readonly originalInput: string, readonly sourceMap = resolution.sourceMap) {
		const diagnostic = mapExpressionDiagnostic(message, sourceMap);
		super(restoreReferenceNames(diagnostic.message, resolution.bindingNames));
		this.sourceSpan = diagnostic.span;
		this.name = 'Note Reference Error';
		this.referencedPaths = resolution.referencedPaths;
		this.dependencies = resolution.dependencies;
	}
}

export function parseCrossNoteReferences(source: string): CrossNoteReference[] {
	return scanExpression(source).filter(token => token.kind === 'reference').map(token => {
		const match = new RegExp(CROSS_NOTE_REF_REGEX.source).exec(token.text)!;
		return { start: token.start, end: token.end, fullMatch: token.text, noteName: match[1], propertyPath: match[2] };
	});
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
		if (!hasOwnProperty(current, part)) return undefined;
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
		if (hasOwnProperty(metadata, numeralsSetting)) {
			result[numeralsSetting] = metadata[numeralsSetting];
		}
	} else if (Array.isArray(numeralsSetting)) {
		for (const entry of numeralsSetting as unknown[]) {
			const key = String(entry);
			if (hasOwnProperty(metadata, key)) {
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

/** Resolve a raw typed property using only the referenced note's opted-in metadata. */
export function resolveSingleReference(
	ref: Pick<CrossNoteReference, 'fullMatch' | 'noteName' | 'propertyPath'>,
	app: App,
	sourcePath: string,
	settings: NumeralsSettings,
	preProcessors: StringReplaceMap[],
): { value?: unknown; referencedPath?: string; status: ReferenceDependency['status']; error?: string } {
	const file = app.metadataCache.getFirstLinkpathDest(ref.noteName, sourcePath);
	if (!file) return { status: 'missing-note', error: `Note "${ref.noteName}" not found in vault` };
	const referencedPath = file.path;
	const metadata = getMetadataForReferencedNote(file, app) ?? {};
	const available = filterAvailableProperties(metadata, settings.forceProcessAllFrontmatter);
	const [key, ...nested] = ref.propertyPath.split('.');
	if (!hasOwnProperty(available, key)) {
		return { referencedPath, status: 'unavailable-property', error: `Property "${key}" not available in "${ref.noteName}". Ensure it exists and is exposed via the numerals frontmatter key or starts with $.` };
	}
	let value: unknown;
	if (nested.length) {
		const raw = getNestedProperty(available, ref.propertyPath);
		if (raw === undefined) return { referencedPath, status: 'unavailable-property', error: `Property "${ref.propertyPath}" not found in "${ref.noteName}"` };
		const evaluated = evaluateMetadataValue(raw, preProcessors);
		if (evaluated.error) return { referencedPath, status: 'invalid-value', error: evaluated.error };
		value = evaluated.result;
	} else {
		const { scope, warnings } = getScopeFromFrontmatter(available, undefined, true, preProcessors);
		if (scope.has(key)) value = scope.get(key);
		else {
			const evaluated = evaluateMetadataValue(available[key], preProcessors);
			if (evaluated.error) return { referencedPath, status: 'invalid-value', error: warnings[0] ?? evaluated.error };
			value = evaluated.result;
		}
	}
	try {
		return { value: cloneReferenceValue(value), referencedPath, status: 'resolved' };
	} catch (error: unknown) {
		return { referencedPath, status: 'invalid-value', error: error instanceof Error ? error.message : String(error) };
	}
}

// Monotonic per runtime, plus source/scope collision checks. Never a shared mutable value table.
let bindingGeneration = 0;

export function resolveCrossNoteReferences(
	source: string,
	app: App,
	sourcePath: string,
	settings: NumeralsSettings,
	preProcessors: StringReplaceMap[],
	occupiedNames: ReadonlyMap<string, unknown> = new Map(),
): CrossNoteResolutionResult {
	const refs = settings.enableCrossNoteReferences ? parseCrossNoteReferences(source) : [];
	const dependencies: ReferenceDependency[] = [];
	const bindings = new Map<string, unknown>();
	const bindingNames = new Map<string, string>();
	const edits = [];
	for (const ref of refs) {
		let result: ReturnType<typeof resolveSingleReference>;
		try { result = resolveSingleReference(ref, app, sourcePath, settings, preProcessors); }
		catch (error: unknown) { result = { status: 'invalid-value', error: error instanceof Error ? error.message : String(error) }; }
		dependencies.push({ ...ref, sourcePath, resolvedPath: result.referencedPath, status: result.status, error: result.error });
		if (result.error) continue;
		let symbol: string;
		do { symbol = `__numerals_ref_${bindingGeneration++}`; } while (source.includes(symbol) || occupiedNames.has(symbol));
		bindings.set(symbol, result.value);
		bindingNames.set(symbol, ref.fullMatch);
		edits.push({ start: ref.start, end: ref.end, text: symbol });
	}
	const sourceMap = applySourceEdits(originalSource(source), edits);
	return {
		resolvedSource: sourceMap.source, sourceMap, bindings, bindingNames, dependencies,
		referencedPaths: [...new Set(dependencies.flatMap(d => d.resolvedPath ? [d.resolvedPath] : []))],
		warnings: [], error: dependencies.find(d => d.error)?.error ?? null,
	};
}
