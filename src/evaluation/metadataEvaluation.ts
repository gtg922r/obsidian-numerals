import type { MathJsInstance } from 'mathjs';
import type { StringReplaceMap } from '../numerals.types';
import { replaceStringsInTextFromMap } from '../processing/preprocessor';
import { getScopeFromFrontmatter } from '../processing/scope';
import type { MetadataEntry, MetadataFreshness } from './metadata';
import { VERIFIED_PROVENANCE, type ValueProvenance } from './provenance';
import { observeRuntimeRow, recordRuntimeRow, type RuntimeRowObservation } from './runtimeProvenance';
import { EvaluationSession, type CalculationEnvironment, type EvaluationGeneration, type RowTransaction } from './session';
import { copyMetadataValue } from './valueOwnership';

export interface MetadataInitializationOutcome {
	readonly key: string;
	readonly status: 'committed' | 'discarded';
	readonly warnings: readonly string[];
	readonly provenance: ValueProvenance;
}

/** A fresh private session; no populated bindings or closures cross captures. */
export function createMetadataSession(engine: MathJsInstance, generation: EvaluationGeneration): EvaluationSession {
	return new EvaluationSession(generation, new Map(), {
		children(value) {
			if (engine.isMatrix(value)) {
				const children: unknown[] = [];
				value.forEach(child => { children.push(child); }, true);
				return children;
			}
			if (engine.isResultSet(value)) return value.entries;
			return undefined;
		},
	});
}

/** Observe inside the active row, before native evaluation or copying inputs. */
export function observeSessionRow(engine: MathJsInstance, session: EvaluationSession,
	environment: CalculationEnvironment, source: string): RuntimeRowObservation {
	const observation = observeRuntimeRow(engine, source, session.copyBindings(environment));
	session.recordInput(observation.input);
	if (observation.recognizedEffect) session.recordOpaqueEffect();
	else if (observation.deferredCapability) session.recordInput({unverified: [], ambiguous: true});
	return observation;
}

/** Call after commit or discard, including native effects preceding a failure. */
export function finishSessionRow(engine: MathJsInstance, transaction: RowTransaction,
	observation: RuntimeRowObservation): ValueProvenance {
	const provenance = transaction.provenance;
	recordRuntimeRow(engine, observation, provenance);
	return provenance;
}

export function metadataEntryProvenance(entry: MetadataEntry, freshness: MetadataFreshness): ValueProvenance {
	return entry.provenance === 'dataview' && freshness.status !== 'verified'
		? {unverified: [`Dataview field ${entry.key}`], ambiguous: false} : VERIFIED_PROVENANCE;
}

/**
 * Initialize captured entries in their original order using the native legacy
 * initializer. Callers own retirement, including when cancellation propagates.
 */
export function initializeMetadataEntries(input: {
	readonly engine: MathJsInstance;
	readonly session: EvaluationSession;
	readonly environment: CalculationEnvironment;
	readonly entries: readonly MetadataEntry[];
	readonly freshness: MetadataFreshness;
	readonly preProcessors: readonly StringReplaceMap[];
	readonly publishGlobals?: boolean;
	readonly signal?: AbortSignal;
}): readonly MetadataInitializationOutcome[] {
	const {engine, session, environment, entries, freshness, signal} = input;
	const processors = [...input.preProcessors];
	const outcomes: MetadataInitializationOutcome[] = [];
	assertCurrent(signal);
	for (const entry of entries) {
		assertCurrent(signal);
		const transaction = session.beginRow(environment, {publishGlobals: input.publishGlobals});
		let observation = observeSessionRow(engine, session, environment, '');
		let status: MetadataInitializationOutcome['status'] = 'discarded';
		let warnings: readonly string[] = [];
		let provenance = VERIFIED_PROVENANCE;
		try {
			const processedValue = typeof entry.value === 'string' ? replaceStringsInTextFromMap(entry.value, processors) : '';
			observation = observeSessionRow(engine, session, environment,
				/^[^(]+\([^)]*\)$/.test(entry.key) ? `${entry.key}=${processedValue}` : processedValue);
			session.recordInput(metadataEntryProvenance(entry, freshness));
			// Capture selected the final top-level array entry exactly once. The
			// compatibility wrapper prevents the legacy initializer selecting again.
			warnings = getScopeFromFrontmatter({numerals: 'all', [entry.key]: [copyMetadataValue(entry.value, engine)]},
				environment.scope, true, processors, false, engine, {runtimeSafety: 'caller'}).warnings;
			assertCurrent(signal);
			if (warnings.length) transaction.discard();
			else { transaction.commit(); status = 'committed'; }
		} catch (error: unknown) {
			transaction.discard();
			assertCurrent(signal);
			warnings = [`Metadata ${entry.key}: ${error instanceof Error ? error.message : String(error)}`];
		} finally {
			provenance = finishSessionRow(engine, transaction, observation);
		}
		outcomes.push(Object.freeze({key: entry.key, status, warnings: Object.freeze([...warnings]), provenance}));
	}
	assertCurrent(signal);
	return Object.freeze(outcomes);
}

function assertCurrent(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Note evaluation was superseded.'); }
