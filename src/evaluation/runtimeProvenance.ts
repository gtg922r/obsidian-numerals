import type { MathJsInstance, MathNode } from 'mathjs';
import { isVerifiedProvenance, mergeProvenance, VERIFIED_PROVENANCE, type ValueProvenance } from './provenance';

interface RuntimeSafety {
	readonly registry: ValueProvenance;
	readonly broad: ValueProvenance;
	readonly epoch: number;
}

// Only safety flags, labels and a monotonic counter survive a note session.
// No mathematical value, scope, closure, note input or runtime callback is retained.
const runtimeSafety = new WeakMap<MathJsInstance, RuntimeSafety>();
const emptySafety: RuntimeSafety = Object.freeze({registry: VERIFIED_PROVENANCE, broad: VERIFIED_PROVENANCE, epoch: 0});
const engineEffectNames = ['createUnit', 'import', 'config', 'evaluate', 'parse', 'compile', 'parser'] as const;
const engineEffects: ReadonlySet<string> = new Set(engineEffectNames);
// Public typed-function 4.x registry API (mathjs's declaration only types the factory).
const typedMutatorNames = ['clear', 'clearConversions', 'addType', 'addTypes', 'addConversion', 'addConversions', 'removeConversion'] as const;
const literalNames = new Set(['true', 'false', 'null']);

export interface RuntimeRowObservation {
	readonly input: ValueProvenance;
	readonly recognizedEffect: boolean;
	/** A captured engine capability is tainted, but capturing it does not mutate the engine. */
	readonly deferredCapability: boolean;
	/** Exactly one checked createUnit call occurs, without any mutation. */
	readonly registryOnly: boolean;
	readonly mayExecuteOpaque: boolean;
	/** Metadata evaluation outside a session must account for private callable/object reads. */
	readonly opaqueInput: boolean;
}

/** Trusted insertion adapters must compare the row's epoch at application time. */
export function runtimeSafetyEpoch(engine: MathJsInstance): number {
	return (runtimeSafety.get(engine) ?? emptySafety).epoch;
}

export function isRuntimeSafetyCurrent(engine: MathJsInstance, epoch: number): boolean {
	return Number.isSafeInteger(epoch) && epoch >= 0 && runtimeSafetyEpoch(engine) === epoch;
}

/** Inspect the actual evaluated source and private binding types without reading their provenance. */
export function observeRuntimeRow(engine: MathJsInstance, source: string,
	bindings: ReadonlyMap<string, unknown>): RuntimeRowObservation {
	const safety = runtimeSafety.get(engine) ?? emptySafety;
	if (!source.trim()) return {input: safety.broad, recognizedEffect: false, deferredCapability: false,
		registryOnly: false, mayExecuteOpaque: false, opaqueInput: false};
	let root: MathNode;
	try { root = engine.parse(source); }
	catch {
		// The authoritative parser rejected the whole source before any AST can
		// execute. Preserve prior safety, but do not invent a new runtime effect.
		return {input: mergeProvenance(safety.broad, safety.registry), recognizedEffect: false,
			deferredCapability: false, registryOnly: false, mayExecuteOpaque: false, opaqueInput: false};
	}
	let registryRead = false, opaqueInput = false, capabilityRead = false, deferredCapability = false, mutation = false;
	const calls: {readonly registryOnly: boolean; readonly opaque: boolean}[] = [];
	const typed: unknown = engine.typed;
	const typedAvailable = typed !== null && !isPrimitive(typed);
	const nativeConvert: unknown = typedAvailable ? Object.getOwnPropertyDescriptor(typed, 'convert')?.value : undefined;
	const callableEffects: ReadonlySet<unknown> = new Set([...engineEffectNames.map(key => engine[key]),
		...typedMutatorNames.map((key): unknown => typedAvailable ? Object.getOwnPropertyDescriptor(typed, key)?.value : undefined)]
		.filter(value => typeof value === 'function'));
	type KnownValue = {readonly known: false} | {readonly known: true; readonly value: unknown};
	const unknownValue: KnownValue = {known: false};
	// Resolve only existing data properties and literal/bound keys. Never evaluate
	// an index expression, invoke a getter, or retain these values beyond the row.
	const knownValue = (node: MathNode, shadows: ReadonlySet<string>): KnownValue => {
		if (engine.isParenthesisNode(node)) return knownValue(node.content, shadows);
		if (engine.isConstantNode(node)) return {known: true, value: node.value};
		if (engine.isSymbolNode(node)) {
			if (shadows.has(node.name)) return unknownValue;
			if (bindings.has(node.name)) return {known: true, value: bindings.get(node.name)};
			return node.name === 'typed' ? {known: true, value: typed} : unknownValue;
		}
		if (engine.isAccessorNode(node) && node.index.dimensions.length === 1) {
			const object = knownValue(node.object, shadows);
			const key = knownValue(node.index.dimensions[0], shadows);
			if (object.known && object.value !== null && !isPrimitive(object.value) && key.known && typeof key.value === 'string') {
				const property = Object.getOwnPropertyDescriptor(object.value, key.value);
				if (property && 'value' in property) return {known: true, value: property.value};
			}
		}
		return unknownValue;
	};
	const capability = (name: string, shadows: ReadonlySet<string>, suppressTyped: boolean): boolean => {
		if (shadows.has(name)) return false;
		if (!bindings.has(name)) return engineEffects.has(name) || (name === 'typed' && typedAvailable && !suppressTyped);
		const value = bindings.get(name);
		return typeof value === 'function' && (callableEffects.has(value) || (value === typed && !suppressTyped));
	};
	const primitiveArgument = (node: MathNode, shadows: ReadonlySet<string>): boolean => {
		if (engine.isParenthesisNode(node)) return primitiveArgument(node.content, shadows);
		if (engine.isConstantNode(node)) return isPrimitive(node.value);
		if (engine.isSymbolNode(node)) return !shadows.has(node.name) && bindings.has(node.name) && isPrimitive(bindings.get(node.name));
		if (!engine.isOperatorNode(node) || !['unaryPlus', 'unaryMinus'].includes(node.fn) || node.args.length !== 1) return false;
		let operand = node.args[0];
		while (engine.isParenthesisNode(operand)) operand = operand.content;
		return engine.isConstantNode(operand) && typeof operand.value === 'number';
	};
	const markCapability = (executed: boolean): void => {
		if (executed) capabilityRead = true;
		else deferredCapability = true;
	};
	const visit = (node: MathNode, shadows: Set<string>, executed: boolean, suppressTyped = false): void => {
		if (engine.isParenthesisNode(node)) {
			visit(node.content, new Set(shadows), executed, suppressTyped);
			return;
		}
		if (engine.isBlockNode(node)) {
			for (const block of node.blocks) visit(block.node, shadows, executed);
			return;
		}
		if (engine.isFunctionAssignmentNode(node)) {
			visit(node.expr, new Set([...shadows, node.name, ...node.params]), false);
			shadows.add(node.name);
			return;
		}
		if (engine.isAssignmentNode(node)) {
			if (node.index || !engine.isSymbolNode(node.object)) {
				if (executed) mutation = true;
				visit(node.object, shadows, executed);
				if (node.index) visit(node.index, shadows, executed);
			}
			visit(node.value, shadows, executed);
			if (!node.index && engine.isSymbolNode(node.object)) shadows.add(node.object.name);
			return;
		}
		if (engine.isAccessorNode(node)) {
			const object = knownValue(node.object, shadows);
			const value = knownValue(node, shadows);
			const typedObject = typedAvailable && object.known && object.value === typed;
			// Known read-only methods (e.g. convert) do not carry a mutation
			// capability. Dynamic access to the native namespace remains uncertain.
			if ((value.known && callableEffects.has(value.value)) || (typedObject && !value.known)) markCapability(executed);
			visit(node.object, new Set(shadows), executed, typedObject);
			visit(node.index, new Set(shadows), executed);
			return;
		}
		if (engine.isSymbolNode(node)) {
			if (capability(node.name, shadows, suppressTyped)) markCapability(executed);
			if (executed && !shadows.has(node.name)) {
				if (!bindings.has(node.name) && !literalNames.has(node.name)) registryRead = true;
				if (bindings.has(node.name) && !isPrimitive(bindings.get(node.name))) opaqueInput = true;
			}
			return;
		}
		const fn = engine.isFunctionNode(node) ? knownValue(node.fn, shadows) : unknownValue;
		if (engine.isFunctionNode(node) && executed) {
			if (engine.isSymbolNode(node.fn) && shadows.has(node.fn.name)) opaqueInput = true;
			// A proven native conversion of two primitive inputs does not execute
			// opaque input behavior, even when its namespace binding is ambiguous.
			calls.push({opaque: !(typeof nativeConvert === 'function' && fn.known && fn.value === nativeConvert &&
				node.args.length === 2 && node.args.every(argument => primitiveArgument(argument, shadows))),
				registryOnly: engine.isSymbolNode(node.fn) && node.fn.name === 'createUnit' &&
				!shadows.has(node.fn.name) && !bindings.has(node.fn.name) && node.args.length >= 1 && node.args.length <= 2 &&
				node.args.every(argument => primitiveArgument(argument, shadows))});
		}
		// A write in one conditional/short-circuit branch does not establish a
		// binding in its sibling. Only ordered statement blocks share new shadows.
		node.forEach(child => visit(child, new Set(shadows), executed,
			engine.isFunctionNode(node) && child === node.fn && fn.known && fn.value === typed));
	};
	visit(root, new Set(), true);
	const mayExecuteOpaque = calls.some(call => call.opaque) || mutation;
	return {
		input: mergeProvenance(safety.broad, registryRead ? safety.registry : VERIFIED_PROVENANCE),
		recognizedEffect: capabilityRead && mayExecuteOpaque,
		deferredCapability: deferredCapability || (capabilityRead && !mayExecuteOpaque),
		registryOnly: calls.length === 1 && calls[0].registryOnly && !mutation,
		mayExecuteOpaque, opaqueInput,
	};
}

/** Call after either commit or discard: engine effects are outside binding rollback. */
export function recordRuntimeRow(engine: MathJsInstance, observation: RuntimeRowObservation,
	provenance: ValueProvenance): void {
	if (!provenance.ambiguous || !observation.mayExecuteOpaque) return;
	const before = runtimeSafety.get(engine) ?? emptySafety;
	const registry = observation.registryOnly ? mergeProvenance(before.registry, provenance) : before.registry;
	const broad = observation.registryOnly ? before.broad : mergeProvenance(before.broad, provenance);
	// A repeated possible effect can invalidate an earlier proposal even when its
	// labels are unchanged. Passive reads never enter here or advance the epoch.
	runtimeSafety.set(engine, {registry, broad, epoch: before.epoch + 1});
}

export function runtimeSafetyDiagnostic(engine: MathJsInstance): string | undefined {
	const safety = runtimeSafety.get(engine) ?? emptySafety;
	if (!isVerifiedProvenance(safety.broad)) {
		return 'Math runtime state has uncertain provenance; automatic insertion is unavailable. Reload Numerals or replace its math runtime to clear this state. Re-evaluation does not clear it.';
	}
	if (!isVerifiedProvenance(safety.registry)) {
		return 'Unit registry state has uncertain provenance; dependent results cannot be inserted automatically. Reload Numerals or replace its math runtime to clear this state. Re-evaluation does not clear it.';
	}
	return undefined;
}

function isPrimitive(value: unknown): boolean {
	return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

/**
 * Legacy/reference metadata comes from external providers, before F's row exists.
 * Observe before evaluation and publish possible effects even if execution or
 * later reference-value validation fails. This wrapper never certifies freshness.
 */
export function evaluateRuntimeMetadata(source: string, engine: MathJsInstance,
	scope: Map<string, unknown> = new Map()): unknown {
	const observation = observeRuntimeRow(engine, source, scope);
	const provenance = mergeProvenance(observation.input, {unverified: ['External metadata evaluation'],
		ambiguous: observation.recognizedEffect || observation.deferredCapability || observation.opaqueInput});
	try { return engine.evaluate(source, scope) as unknown; }
	finally { recordRuntimeRow(engine, observation, provenance); }
}
