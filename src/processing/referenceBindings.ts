import { MappedSource, mapSourceSpan, scanExpression, SourceSpan } from './expressionScanner';
import type { MathJsInstance, MathNode } from 'mathjs';
import { getMathRuntime } from '../mathRuntime';
import { NumeralsScope } from '../numerals.types';
import { copyEvaluationValue } from '../evaluation/valueOwnership';

/** Values exported across notes; arbitrary objects and functions are deliberately excluded. */
export function isSupportedReferenceValue(value: unknown, runtime: MathJsInstance = getMathRuntime()): boolean {
	return isSupportedValue(value, runtime, new Set());
}

function isSupportedValue(value: unknown, runtime: MathJsInstance, ancestors: Set<object>): boolean {
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'bigint') return true;
	if (runtime.isComplex(value) || runtime.isBigNumber(value) || runtime.isFraction(value) || runtime.isUnit(value)) return true;
	if (value === null || typeof value !== 'object' || ancestors.has(value)) return false;
	const next = new Set(ancestors).add(value);
	if (Array.isArray(value)) return value.every(entry => isSupportedValue(entry, runtime, next));
	if (runtime.isMatrix(value)) return isSupportedValue(value.toArray(), runtime, next);
	return false;
}

/** Copy supported typed values with the originating runtime's public APIs. */
export function cloneReferenceValue(value: unknown, runtime: MathJsInstance = getMathRuntime()): unknown {
	if (!isSupportedReferenceValue(value, runtime)) throw new Error('Reference value must be a scalar, unit, complex number, or matrix; functions and objects cannot be exported');
	return copyEvaluationValue(value, runtime);
}

export interface ReferenceScopeOptions {
	readonly runtime?: MathJsInstance;
	/** Called before borrowing a fresh clone, including reads in defining closures. */
	readonly onRead?: (name: string, value: unknown) => void;
}

/**
 * Each calculation owns its binding table. Functions defined here retain this table;
 * subsequent calculations never replace it. Writes to ordinary scope still propagate.
 */
export function createReferenceScope(scope: NumeralsScope, bindings: ReadonlyMap<string, unknown>,
	options: ReferenceScopeOptions = {}): NumeralsScope {
	const runtime = options.runtime ?? getMathRuntime();
	const onRead = options.onRead;
	const ownedBindings = new Map(bindings);
	for (const key of ownedBindings.keys()) {
		if (scope.has(key)) throw new Error('Internal reference binding conflicts with an existing variable');
	}
	class ReferenceScope extends NumeralsScope {
		override has(key: string): boolean { return ownedBindings.has(key) || scope.has(key); }
		override get(key: string): unknown {
			// Return a fresh value even for access through a mutating user function.
			if (!ownedBindings.has(key)) return scope.get(key);
			const value = ownedBindings.get(key);
			onRead?.(key, value);
			return cloneReferenceValue(value, runtime);
		}
		override set(key: string, value: unknown): this {
			if (ownedBindings.has(key)) throw new Error('Cannot assign to a cross-note reference');
			scope.set(key, value);
			return this;
		}
		override get size(): number { return scope.size + ownedBindings.size; }
		override *keys(): MapIterator<string> { yield* scope.keys(); yield* ownedBindings.keys(); }
		override entries(): MapIterator<[string, unknown]> { return new Map([...this.keys()].map(key => [key, this.get(key)] as [string, unknown])).entries(); }
		override values(): MapIterator<unknown> { return new Map(this.entries()).values(); }
		override [Symbol.iterator](): MapIterator<[string, unknown]> { return this.entries(); }
		override forEach(callback: (value: unknown, key: string, map: Map<string, unknown>) => void, thisArg?: unknown): void {
			for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
		}
		override delete(key: string): boolean {
			if (ownedBindings.has(key)) throw new Error('Cannot delete a cross-note reference');
			return scope.delete(key);
		}
		override clear(): void {
			if (ownedBindings.size) throw new Error('Cannot clear cross-note references');
			scope.clear();
		}
	}
	return new ReferenceScope();
}

export function evaluateWithReferences(source: string, scope: NumeralsScope, bindings: ReadonlyMap<string, unknown> = new Map(),
	runtime: MathJsInstance = getMathRuntime()): unknown {
	const node = runtime.parse(source);
	node.traverse(child => {
		if (runtime.isAssignmentNode(child)) {
			let target: MathNode = child.object;
			while (runtime.isAccessorNode(target)) target = target.object;
			if (runtime.isSymbolNode(target) && bindings.has(target.name)) throw new Error('Cannot assign to a cross-note reference');
		}
		if (runtime.isFunctionAssignmentNode(child) && (bindings.has(child.name) || child.params.some(param => bindings.has(param)))) {
			throw new Error('Cannot assign to a cross-note reference');
		}
	});
	return node.compile().evaluate(scope) as unknown;
}

export function restoreReferenceNames(message: string, names: ReadonlyMap<string, string>): string {
	let restored = message;
	for (const token of scanExpression(message).reverse()) {
		if (token.kind === 'identifier' && names.has(token.text)) {
			restored = restored.slice(0, token.start) + names.get(token.text)! + restored.slice(token.end);
		}
	}
	return restored;
}

/** Translate mathjs's one-based parser character offset through all source edits. */
export function mapExpressionDiagnostic(message: string, mapped: MappedSource, generatedBase = 0, originalBase = 0): { message: string; span?: SourceSpan } {
	const match = /\(char (\d+)\)$/.exec(message);
	if (!match) return { message };
	const offset = Math.min(mapped.source.length, generatedBase + Number(match[1]) - 1);
	const span = mapSourceSpan(mapped, { start: offset, end: Math.min(offset + 1, mapped.source.length) });
	return { message: message.replace(/\(char \d+\)$/, `(char ${span.start - originalBase + 1})`), span };
}
