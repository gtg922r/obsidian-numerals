import { MappedSource, mapSourceSpan, scanExpression, SourceSpan } from './expressionScanner';
import * as math from 'mathjs';
import { NumeralsScope } from '../numerals.types';

/** Values exported across notes; arbitrary objects and functions are deliberately excluded. */
export function isSupportedReferenceValue(value: unknown): boolean {
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'bigint') return true;
	if (math.isComplex(value) || math.isBigNumber(value) || math.isFraction(value) || math.isUnit(value)) return true;
	if (Array.isArray(value)) return value.every(isSupportedReferenceValue);
	if (math.isMatrix(value)) return isSupportedReferenceValue(value.toArray());
	return false;
}

/** Public mathjs clone preserves typed values, including matrix elements and unit precision. */
export function cloneReferenceValue(value: unknown): unknown {
	if (!isSupportedReferenceValue(value)) throw new Error('Reference value must be a scalar, unit, complex number, or matrix; functions and objects cannot be exported');
	return math.clone(value);
}

/**
 * Each calculation owns its binding table. Functions defined here retain this table;
 * subsequent calculations never replace it. Writes to ordinary scope still propagate.
 */
export function createReferenceScope(scope: NumeralsScope, bindings: ReadonlyMap<string, unknown>): NumeralsScope {
	for (const key of bindings.keys()) {
		if (scope.has(key)) throw new Error('Internal reference binding conflicts with an existing variable');
	}
	class ReferenceScope extends NumeralsScope {
		override has(key: string): boolean { return bindings.has(key) || scope.has(key); }
		override get(key: string): unknown {
			// Return a fresh value even for access through a mutating user function.
			return bindings.has(key) ? cloneReferenceValue(bindings.get(key)) : scope.get(key);
		}
		override set(key: string, value: unknown): this {
			if (bindings.has(key)) throw new Error('Cannot assign to a cross-note reference');
			scope.set(key, value);
			return this;
		}
		override get size(): number { return scope.size + bindings.size; }
		override keys(): MapIterator<string> { return new Map([...scope, ...bindings]).keys(); }
		override entries(): MapIterator<[string, unknown]> { return new Map([...this.keys()].map(key => [key, this.get(key)] as [string, unknown])).entries(); }
		override values(): MapIterator<unknown> { return new Map(this.entries()).values(); }
		override [Symbol.iterator](): MapIterator<[string, unknown]> { return this.entries(); }
		override forEach(callback: (value: unknown, key: string, map: Map<string, unknown>) => void, thisArg?: unknown): void {
			for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
		}
		override delete(key: string): boolean {
			if (bindings.has(key)) throw new Error('Cannot delete a cross-note reference');
			return scope.delete(key);
		}
		override clear(): void {
			if (bindings.size) throw new Error('Cannot clear cross-note references');
			scope.clear();
		}
	}
	return new ReferenceScope();
}

export function evaluateWithReferences(source: string, scope: NumeralsScope, bindings: ReadonlyMap<string, unknown> = new Map()): unknown {
	const node = math.parse(source);
	node.traverse(child => {
		if (math.isAssignmentNode(child)) {
			let target: math.MathNode = child.object;
			while (math.isAccessorNode(target)) target = target.object;
			if (math.isSymbolNode(target) && bindings.has(target.name)) throw new Error('Cannot assign to a cross-note reference');
		}
		if (math.isFunctionAssignmentNode(child) && (bindings.has(child.name) || child.params.some(param => bindings.has(param)))) {
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
