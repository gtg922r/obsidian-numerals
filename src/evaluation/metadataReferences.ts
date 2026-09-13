import type { StringReplaceMap } from '../numerals.types';
import { getNestedProperty, type ResolvedReference } from '../processing/crossNoteResolver';
import { cloneReferenceValue } from '../processing/referenceBindings';
import { replaceStringsInTextFromMap } from '../processing/preprocessor';
import { captureNoteMetadata, type CaptureNoteMetadataInput, type MetadataSource, type MetadataEntry } from './metadata';
import { createMetadataSession, finishSessionRow, initializeMetadataEntries, metadataEntryProvenance,
	observeSessionRow, type MetadataInitializationOutcome } from './metadataEvaluation';
import type { CalculationEnvironment, EvaluationSession } from './session';
import { VERIFIED_PROVENANCE, type ValueProvenance } from './provenance';

/** Private capture input. The host groups requests by the exact target generation. */
export interface CapturedMetadataReferenceRequest extends CaptureNoteMetadataInput {
	readonly source: MetadataSource & { readonly path: string };
	readonly metadataGeneration: string;
	readonly runtimeGeneration: number;
	readonly preProcessors: readonly StringReplaceMap[];
	readonly propertyPaths: readonly string[];
}

/** Typed values belong only to the private reference capture pipeline, never widgets. */
export interface CapturedMetadataReferenceResult {
	readonly propertyPath: string;
	readonly result: ResolvedReference;
	readonly provenance: ValueProvenance;
}

/**
 * Resolve one target capture synchronously, in first-use order. No App, cache or
 * source evaluator is involved. Each unique path is sampled once; duplicates
 * receive separate typed copies. Sessions never survive this call.
 */
export function resolveCapturedMetadataReferences(input: CapturedMetadataReferenceRequest,
	signal?: AbortSignal): readonly CapturedMetadataReferenceResult[] {
	assertCurrent(signal);
	const metadata = captureNoteMetadata(input);
	assertCurrent(signal);
	const engine = input.engine;
	const processors = [...input.preProcessors];
	const entries = new Map(metadata.entries.map(entry => [entry.key, entry]));
	const generation = {sourceRevision: String(input.source.revision),
		metadataGeneration: input.metadataGeneration, runtimeGeneration: input.runtimeGeneration};
	let rootSession: EvaluationSession | undefined;
	let rootEnvironment: CalculationEnvironment | undefined;
	let rootOutcomes = new Map<string, MetadataInitializationOutcome>();
	let leafSession: EvaluationSession | undefined;
	let leafIndex = 0;
	const samples = new Map<string, CapturedMetadataReferenceResult>();
	const failure = (propertyPath: string, status: 'unavailable-property' | 'invalid-value', error: string,
		provenance = VERIFIED_PROVENANCE): CapturedMetadataReferenceResult => ({propertyPath,
		result: {referencedPath: input.source.path, status, error}, provenance});
	const initializeRoots = (): {session: EvaluationSession; environment: CalculationEnvironment} => {
		if (!rootSession) {
			rootSession = createMetadataSession(engine, generation);
			rootEnvironment = rootSession.createEnvironment('metadata-reference-roots');
			rootOutcomes = new Map(initializeMetadataEntries({engine, session: rootSession, environment: rootEnvironment,
				entries: metadata.entries, freshness: metadata.freshness, preProcessors: processors, signal})
				.map(outcome => [outcome.key, outcome]));
		}
		return {session: rootSession, environment: rootEnvironment!};
	};
	const resolveRoot = (propertyPath: string): CapturedMetadataReferenceResult => {
		const {session, environment} = initializeRoots();
		assertCurrent(signal);
		const transaction = session.beginRow(environment);
		const observation = observeSessionRow(engine, session, environment, '');
		let result: ResolvedReference;
		let provenance: ValueProvenance;
		try {
			if (!environment.scope.has(propertyPath)) {
				const outcome = rootOutcomes.get(propertyPath);
				if (outcome) session.recordInput(outcome.provenance);
				throw new Error(outcome?.warnings[0] ?? 'Value is undefined');
			}
			const value = environment.scope.get(propertyPath);
			result = {referencedPath: input.source.path, status: 'resolved', value: cloneReferenceValue(value, engine)};
			assertCurrent(signal);
		} catch (error: unknown) {
			assertCurrent(signal);
			result = {referencedPath: input.source.path, status: 'invalid-value', error: errorMessage(error)};
		} finally {
			transaction.discard();
			provenance = finishSessionRow(engine, transaction, observation);
		}
		return {propertyPath, result, provenance};
	};
	const resolveLeaf = (propertyPath: string, entry: MetadataEntry): CapturedMetadataReferenceResult => {
		const provenance = metadataEntryProvenance(entry, metadata.freshness);
		// Traverse the original opted-in root, not its selected final array item.
		// Metadata capture already detached this graph and rejected accessors.
		let value = getNestedProperty(Object.fromEntries([[entry.key, entry.rawValue]]), propertyPath);
		if (value === undefined) return failure(propertyPath, 'unavailable-property',
			`Property "${propertyPath}" not found in "${input.source.path}"`, provenance);
		// This is D's leaf rule. An array produced by evaluating a string below is
		// an actual result and must not pass through this selection a second time.
		if (Array.isArray(value)) value = value[value.length - 1];
		leafSession ??= createMetadataSession(engine, generation);
		const session = leafSession;
		// D evaluates nested leaf strings in an empty scope. Neither root metadata
		// nor bindings from another leaf are in scope, including dollar globals.
		const environment = session.createEnvironment(`metadata-reference-leaf:${leafIndex++}`);
		const transaction = session.beginRow(environment);
		let observation = observeSessionRow(engine, session, environment, '');
		let result: ResolvedReference;
		let resultProvenance: ValueProvenance;
		try {
			session.recordInput(provenance);
			if (value === undefined || value === null) throw new Error('Value is undefined');
			if (typeof value === 'string') {
				const source = replaceStringsInTextFromMap(value, processors);
				observation = observeSessionRow(engine, session, environment, source);
				value = engine.evaluate(source, environment.scope) as unknown;
			} else if (typeof value === 'number') value = engine.number(value);
			result = {referencedPath: input.source.path, status: 'resolved', value: cloneReferenceValue(value, engine)};
			assertCurrent(signal);
		} catch (error: unknown) {
			assertCurrent(signal);
			result = {referencedPath: input.source.path, status: 'invalid-value', error: errorMessage(error)};
		} finally {
			// Capturing a value never publishes leaf assignments to another path.
			transaction.discard();
			resultProvenance = finishSessionRow(engine, transaction, observation);
		}
		return {propertyPath, result, provenance: resultProvenance};
	};
	try {
		for (const propertyPath of input.propertyPaths) {
			assertCurrent(signal);
			if (samples.has(propertyPath)) continue;
			const key = propertyPath.split('.')[0];
			const entry = entries.get(key);
			const sample = !entry
				? failure(propertyPath, 'unavailable-property', `Property "${key}" not available in "${input.source.path}". Ensure it exists and is exposed via the numerals frontmatter key or starts with $.`)
				: propertyPath === key ? resolveRoot(propertyPath) : resolveLeaf(propertyPath, entry);
			samples.set(propertyPath, sample);
		}
		assertCurrent(signal);
		const copies = new Map<string, ResolvedReference[]>();
		const counts = new Map<string, number>();
		for (const path of input.propertyPaths) counts.set(path, (counts.get(path) ?? 0) + 1);
		for (const [propertyPath, sample] of samples) {
			assertCurrent(signal);
			try {
				copies.set(propertyPath, Array.from({length: counts.get(propertyPath)!}, () => {
					assertCurrent(signal);
					return {...sample.result, ...(sample.result.status === 'resolved'
						? {value: cloneReferenceValue(sample.result.value, engine)} : {})};
				}));
			} catch (error: unknown) {
				assertCurrent(signal);
				// A copy failure belongs to the shared field sample. Do not retry it
				// for another occurrence or return a partially successful field.
				copies.set(propertyPath, Array.from({length: counts.get(propertyPath)!}, () => ({
					referencedPath: input.source.path, status: 'invalid-value', error: errorMessage(error)})));
			}
		}
		const positions = new Map<string, number>();
		const results = input.propertyPaths.map(propertyPath => {
			const position = positions.get(propertyPath) ?? 0;
			positions.set(propertyPath, position + 1);
			return {propertyPath, result: copies.get(propertyPath)![position], provenance: samples.get(propertyPath)!.provenance};
		});
		assertCurrent(signal);
		return results;
	} finally {
		rootSession?.retire();
		leafSession?.retire();
	}
}

function assertCurrent(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error('Metadata reference capture was superseded.');
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
