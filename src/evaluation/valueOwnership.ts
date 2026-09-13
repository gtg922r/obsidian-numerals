import type { BigNumber, MathJsInstance, ResultSet } from 'mathjs';

/** Executable closures never cross the note snapshot boundary, even inside collections. */
export interface FunctionDescription {
	readonly kind: 'numerals-function';
	readonly syntax: string;
}

export interface OpaqueValueDescription {
	readonly kind: 'numerals-opaque';
	readonly type: string;
	readonly text: string;
}

/** Only descriptors created at a private detachment boundary receive this brand. */
const ownedDescriptions = new WeakSet<object>();
const nativeFunctionStrings = new WeakMap<FunctionDescription, string>();

function ownDescription<T extends FunctionDescription | OpaqueValueDescription>(value: T): T {
	ownedDescriptions.add(value);
	return Object.freeze(value);
}

/** Detection only: arbitrary user objects cannot obtain ownership by matching fields. */
export function isOwnedResultDescription(value: unknown): value is FunctionDescription | OpaqueValueDescription {
	return value !== null && typeof value === 'object' && ownedDescriptions.has(value);
}

/** Private presentation compatibility text; public descriptions never contain it. */
export function getOwnedFunctionString(value: unknown): string | undefined {
	return isFunctionDescription(value) ? nativeFunctionStrings.get(value) : undefined;
}

/** Data-only inspection values. Typed native objects remain private to formatting. */
export type ResultDescription = null | undefined | number | boolean | string | bigint |
	FunctionDescription | OpaqueValueDescription |
	{ readonly kind: 'numerals-collection'; readonly type: 'array' | 'matrix' | 'result-set'; readonly entries: readonly ResultDescription[] } |
	{ readonly kind: 'numerals-matrix'; readonly dimensions: readonly number[]; readonly entries: readonly { readonly index: readonly number[]; readonly value: ResultDescription }[] } |
	{ readonly kind: 'numerals-object'; readonly entries: readonly { readonly key: string; readonly value: ResultDescription }[] } |
	{ readonly kind: 'numerals-value'; readonly type: string; readonly text: string } |
	{ readonly kind: 'numerals-cycle' };

/** Native Unit methods can recreate registry references. Never expose them to surfaces. */
export function describeResult(value: unknown, engine: MathJsInstance): ResultDescription {
	return describeValue(value, engine, new Set());
}

function describeValue(value: unknown, engine: MathJsInstance, ancestors: Set<object>): ResultDescription {
	if (typeof value === 'function') {
		const description = detachResult(value, engine) as FunctionDescription;
		return {kind: 'numerals-function', syntax: description.syntax};
	}
	if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean' ||
		typeof value === 'string' || typeof value === 'bigint') return value;
	if (typeof value !== 'object') return { kind: 'numerals-value', type: typeof value, text: '[unsupported primitive]' };
	if (ancestors.has(value)) return { kind: 'numerals-cycle' };
	const next = new Set(ancestors).add(value);
	const describe = (entry: unknown): ResultDescription => describeValue(entry, engine, next);
	if (isOwnedResultDescription(value)) return {...value};
	if (Array.isArray(value)) return { kind: 'numerals-collection', type: 'array', entries: value.map(describe) };
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype === Object.prototype || prototype === null) {
		return { kind: 'numerals-object', entries: Object.keys(value).map(key => {
			const property = Object.getOwnPropertyDescriptor(value, key);
			return { key, value: property && 'value' in property ? describe(property.value) :
				{ kind: 'numerals-value', type: 'accessor', text: '[accessor]' } };
		}) };
	}
	if (engine.isResultSet(value)) return { kind: 'numerals-collection', type: 'result-set', entries: value.entries.map(describe) };
	if (engine.isMatrix(value)) {
		const entries: { index: number[]; value: ResultDescription }[] = [];
		value.forEach((entry: unknown, index) => entries.push({index: [...index], value: describe(entry)}), true);
		return { kind: 'numerals-matrix', dimensions: value.size(), entries };
	}
	return { kind: 'numerals-value', type: engine.typeOf(value), text: engine.format(value) };
}

export function isFunctionDescription(value: unknown): value is FunctionDescription {
	return isOwnedResultDescription(value) && value.kind === 'numerals-function';
}

type FunctionPolicy = 'retain' | 'describe' | 'reject';

/**
 * Copies at ownership boundaries, never between successful rows' live scope frames.
 * The private variant retains native closures for @prev and ordinary aliases. It
 * must never be returned to a renderer, a host adapter, or a later generation.
 */
export function copyEvaluationValue(value: unknown, engine: MathJsInstance): unknown {
	return copyValue(value, engine, 'retain', new Map());
}

/** Metadata providers cannot inject an executable function from an older scope. */
export function copyMetadataValue(value: unknown, engine: MathJsInstance): unknown {
	return copyValue(value, engine, 'reject', new Map());
}

/** Evaluator-owned result copy. Native objects here must not be exposed to surfaces. */
export function detachResult(value: unknown, engine: MathJsInstance): unknown {
	return copyValue(value, engine, 'describe', new Map());
}

function copyValue(value: unknown, engine: MathJsInstance, functions: FunctionPolicy,
	seen: Map<object, unknown>): unknown {
	if (typeof value === 'function') {
		if (functions === 'retain') return value;
		if (functions === 'reject') throw new Error('Metadata contains an executable function; provide its source declaration instead.');
		const syntax: unknown = 'syntax' in value ? value.syntax : undefined;
		const description = ownDescription({ kind: 'numerals-function', syntax: typeof syntax === 'string' ? syntax : value.name || 'function' });
		nativeFunctionStrings.set(description, String(value));
		return description;
	}
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value);
	if (isOwnedResultDescription(value)) {
		const result = ownDescription({...value});
		if (isFunctionDescription(value) && result.kind === 'numerals-function') {
			const nativeString = nativeFunctionStrings.get(value);
			if (nativeString !== undefined) nativeFunctionStrings.set(result, nativeString);
		}
		seen.set(value, result);
		return result;
	}
	if (value instanceof Date) return new Date(value.getTime());
	if (Array.isArray(value)) {
		const result: unknown[] = [];
		seen.set(value, result);
		for (const entry of value) result.push(copyValue(entry, engine, functions, seen));
		return result;
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype === Object.prototype || prototype === null) {
		const result: Record<string, unknown> = {};
		seen.set(value, result);
		for (const key of Object.keys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			// Do not invoke an accessor supplied by an external metadata provider.
			if (!descriptor || !('value' in descriptor)) throw new Error('Cannot detach an object with accessor properties.');
			Object.defineProperty(result, key, { value: copyValue(descriptor.value, engine, functions, seen),
				enumerable: true, configurable: true, writable: true });
		}
		return result;
	}
	if (engine.isResultSet(value)) {
		// Public constructor exists at runtime but is missing from mathjs 15.2's
		// MathJsInstance declaration. math.clone(ResultSet) itself throws.
		const ResultSetConstructor = (engine as MathJsInstance & {
			ResultSet: new (entries: unknown[]) => ResultSet;
		}).ResultSet;
		const result = new ResultSetConstructor([]);
		seen.set(value, result);
		result.entries = value.entries.map(entry => copyValue(entry, engine, functions, seen));
		return result;
	}
	if (engine.isMatrix(value)) {
		// Matrix.clone recursively clones elements before we can handle ResultSet,
		// and can return an immutable matrix. Construct a writable public container.
		const result = engine.matrix(value.storage() === 'sparse' ? 'sparse' : 'dense');
		seen.set(value, result);
		result.resize(value.size());
		value.forEach((entry: unknown, index) => {
			result.set(index, copyValue(entry, engine, functions, seen));
		}, true);
		return result;
	}
	if (engine.isBigNumber(value)) {
		// math.clone and bignumber(value) return identity. The public constructor
		// copies exactly, including signed zero/non-finite values, without rounding.
		const BigNumberConstructor = (engine as MathJsInstance & {
			BigNumber: new (value: BigNumber) => BigNumber;
		}).BigNumber;
		const result = new BigNumberConstructor(value);
		seen.set(value, result);
		return result;
	}
	if (engine.isUnit(value)) {
		const result = value.clone();
		seen.set(value, result);
		// Preserve raw precision and flags without reparsing formatted source.
		// Native Units intentionally keep their owning runtime registry; public
		// consumers receive describeResult/formatter output, never this object.
		result.value = copyValue(value.value, engine, functions, seen) as typeof result.value;
		return result;
	}
	if (engine.isComplex(value) || engine.isFraction(value) ||
		engine.isRange(value) || engine.isIndex(value)) {
		const result: unknown = engine.clone(value);
		seen.set(value, result);
		return result;
	}
	if (functions === 'reject') throw new Error('Metadata contains an unsupported object.');
	if (functions === 'retain') return engine.clone(value);
	// Other native mathjs results (for example Help or Chain) may own opaque
	// closures. A display description preserves output without exposing them.
	const description: OpaqueValueDescription = {
		kind: 'numerals-opaque', type: engine.typeOf(value), text: engine.format(value),
	};
	return ownDescription(description);
}
