import type { StringReplaceMap } from '../numerals.types';
import { evaluateMathFromSourceStrings } from '../processing/evaluator';
import { evaluateInlineExpression } from '../inline/inlineEvaluator';
import { bindCrossNoteReferences, ReferenceEvaluationError, type CrossNoteReference, type ResolvedReference, type CrossNoteResolutionResult } from '../processing/crossNoteResolver';
import { originalSource, scanExpression } from '../processing/expressionScanner';
import { restoreReferenceNames } from '../processing/referenceBindings';
import { preProcessBlockForNumeralsDirectives, replaceStringsInTextFromMap } from '../processing/preprocessor';
import { getScopeFromFrontmatter } from '../processing/scope';
import { indexNote, type NoteSourceIndex, type SourceSyntaxPolicy, type CalculationSource } from './sourceIndex';
import { sourceSpansForRange, type SourceProjection } from './sourceProjection';
import { captureNoteMetadata, type CapturedNoteMetadata, type DataviewMetadataInput, type MetadataEntry } from './metadata';
import { EvaluationSession, type CalculationEnvironment, type RowTransaction } from './session';
import { mergeProvenance, isVerifiedProvenance, VERIFIED_PROVENANCE, type ValueProvenance } from './provenance';
import { copyEvaluationValue, copyMetadataValue, detachResult } from './valueOwnership';
import { createNoteSnapshot, recordSymbolCheckpoint, type CalculationResult, type NoteDiagnostic, type NoteRowResult, type NoteSnapshot, type SymbolCheckpoint } from './noteSnapshot';
import type { NoteServiceInput } from './noteService';
import { observeRuntimeRow, recordRuntimeRow, runtimeSafetyDiagnostic, runtimeSafetyEpoch, type RuntimeRowObservation } from './runtimeProvenance';

/** Offsets are relative to this calculation's unprocessed expression projection. */
export interface CapturedNoteReference {
	readonly calculationId: string;
	readonly start: number;
	readonly end: number;
	readonly fullMatch: string;
	/** Typed values may only be borrowed by the engine that captured them. */
	readonly runtime: MathJsInstance;
	readonly result: ResolvedReference;
	/** Omission cannot certify an external cache's current-buffer provenance. */
	readonly provenance?: ValueProvenance;
}

export interface NoteEvaluationRequest extends NoteServiceInput {
	readonly preProcessors: readonly StringReplaceMap[];
	readonly syntax?: SourceSyntaxPolicy;
	readonly parseYaml: (yaml: string) => unknown;
	readonly forceAllMetadata?: boolean;
	readonly dataview?: DataviewMetadataInput;
	readonly references?: readonly CapturedNoteReference[];
	readonly crossNoteReferencesEnabled?: boolean;
	readonly nowMs?: number;
}

/** Private orchestration input. Never hand it to a renderer or reuse populated scopes. */
export interface CapturedNoteEvaluationInput extends NoteServiceInput {
	readonly index: NoteSourceIndex;
	readonly metadata: CapturedNoteMetadata;
	readonly references: readonly CapturedNoteReference[];
	readonly preProcessors: readonly StringReplaceMap[];
	readonly crossNoteReferencesEnabled: boolean;
}

/** All host-facing callbacks and copies run synchronously, before service scheduling. */
export function captureNoteEvaluationInput(input: NoteEvaluationRequest): CapturedNoteEvaluationInput {
	const generation = { ...input.generation };
	const runtime = { ...input.runtime };
	const source = {sourceId: generation.sourceId, path: generation.sourcePath,
		revision: generation.sourceRevision, text: generation.sourceText};
	const index = indexNote(source, input.syntax);
	const blocked = Boolean(runtime.configurationError) || index.evaluationBlocked;
	const metadata: CapturedNoteMetadata = blocked
		? {nativeEntries: [], entries: [], freshness: {status: 'native-ready', nativeReady: true, projectionUsed: false,
			allowsAutomaticInsertion: false}, warnings: [], quarantinedFields: [], frontmatter: {status: 'absent'}}
		: captureNoteMetadata({source, engine: runtime.engine, parseYaml: input.parseYaml,
			forceAll: input.forceAllMetadata, dataview: input.dataview, nowMs: input.nowMs});
	const references = blocked ? [] : (input.references ?? []).map(reference => {
		let result: ResolvedReference;
		try {
			if (reference.runtime !== runtime.engine) throw new Error('Reference was captured with a different math runtime.');
			result = {...reference.result, value: reference.result.status === 'resolved'
				? copyMetadataValue(reference.result.value, runtime.engine) : undefined};
		} catch (error: unknown) {
			result = {status: 'invalid-value', referencedPath: reference.result.referencedPath, error: errorMessage(error)};
		}
		return {...reference, result, provenance: reference.provenance && mergeProvenance(reference.provenance)};
	});
	return {generation, runtime, index, metadata, references,
		preProcessors: input.preProcessors.map(processor => ({...processor, regex: new RegExp(processor.regex.source, processor.regex.flags)})),
		crossNoteReferencesEnabled: input.crossNoteReferencesEnabled ?? true};
}

/** One complete physical pass. Mathjs and the existing D evaluators execute every row. */
export function evaluateNote(input: CapturedNoteEvaluationInput, signal?: AbortSignal): NoteSnapshot {
	const { generation, runtime, index, metadata } = input;
	const engine = runtime.engine;
	const diagnostics: NoteDiagnostic[] = index.diagnostics.map(item => ({kind: 'evaluation', message: item.message, sourceSpans: [item.span]}));
	if (runtime.configurationError || index.evaluationBlocked) {
		if (runtime.configurationError) diagnostics.unshift({kind: 'configuration', message: runtime.configurationError});
		return createNoteSnapshot({generation, calculations: [], diagnostics, symbols: [], metadataStatus: metadata.freshness.status}, engine, runtime.formatter);
	}
	assertCurrent(signal);
	diagnostics.push(...metadata.warnings.map(message => ({kind: 'metadata' as const, message})));
	if (metadata.freshness.reason) diagnostics.push({kind: 'metadata', message: metadata.freshness.reason});
	const session = new EvaluationSession({sourceRevision: String(generation.sourceRevision),
		metadataGeneration: generation.metadataRevision, runtimeGeneration: generation.runtimeGeneration}, new Map(), {
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
	const calculations: CalculationResult[] = [];
	const symbols: SymbolCheckpoint[] = [];
	const processors = [...input.preProcessors];
	const finishProvenance = (transaction: RowTransaction, observation: RuntimeRowObservation): ValueProvenance => {
		const provenance = transaction.provenance;
		recordRuntimeRow(engine, observation, provenance);
		return provenance;
	};
	const observeEngine = (source: string, environment: CalculationEnvironment) => {
		const observation = observeRuntimeRow(engine, source, session.copyBindings(environment));
		session.recordInput(observation.input);
		if (observation.recognizedEffect) session.recordOpaqueEffect();
		else if (observation.deferredCapability) session.recordInput({unverified: [], ambiguous: true});
		return observation;
	};
	const initialize = (environment: CalculationEnvironment, entries: readonly MetadataEntry[], publishGlobals = true) => {
		for (const entry of entries) {
			assertCurrent(signal);
			const transaction = session.beginRow(environment, {publishGlobals});
			let observation = observeEngine('', environment);
			try {
				const processedValue = typeof entry.value === 'string' ? replaceStringsInTextFromMap(entry.value, processors) : '';
				observation = observeEngine(/^[^(]+\([^)]*\)$/.test(entry.key) ? `${entry.key}=${processedValue}` : processedValue, environment);
				const provenance = entry.provenance === 'dataview' && metadata.freshness.status !== 'verified'
					? {unverified: [`Dataview field ${entry.key}`], ambiguous: false} : VERIFIED_PROVENANCE;
				session.recordInput(provenance);
				// Capture already applied the legacy last-array-entry rule exactly once.
				// Wrap it once for the existing initializer instead of selecting again.
				const {warnings} = getScopeFromFrontmatter({numerals: 'all', [entry.key]: [copyMetadataValue(entry.value, engine)]},
					environment.scope, true, processors, false, engine, {runtimeSafety: 'caller'});
				if (warnings.length) {
					transaction.discard();
					diagnostics.push(...warnings.map(message => ({kind: 'metadata' as const, message})));
				} else transaction.commit();
			} catch (error: unknown) {
				transaction.discard();
				diagnostics.push({kind: 'metadata', message: `Metadata ${entry.key}: ${errorMessage(error)}`});
			}
			finishProvenance(transaction, observation);
		}
	};
	const copyPayload = (value: unknown): unknown => {
		try { return copyEvaluationValue(value, engine); }
		catch (error: unknown) {
			diagnostics.push({kind: 'evaluation', message: `Cannot retain a previous-result value: ${errorMessage(error)}`});
			return undefined;
		}
	};
	const checkpoint = (offset: number, environment: CalculationEnvironment) => {
		try { symbols.push(recordSymbolCheckpoint(offset, environment.calculationId, session.copyBindings(environment), engine)); }
		catch (error: unknown) { diagnostics.push({kind: 'presentation', message: `Cannot describe symbols: ${errorMessage(error)}`}); }
	};
	try {
		// Metadata globals are evaluated only here. Their ordinary free variables
		// belong to this fresh metadata environment, never to a previous generation.
		const seeds = session.createEnvironment('metadata');
		initialize(seeds, metadata.entries);
		const metadataSymbols = recordSymbolCheckpoint(0, undefined, session.copyBindings(seeds), engine).symbols;
		symbols.push(recordSymbolCheckpoint(0, undefined, session.copyGlobals(), engine));
		const locals = metadata.entries.filter(entry => !entry.key.startsWith('$'));
		let inlinePrevious: {value: unknown; provenance: ValueProvenance} | undefined;
		for (const calculation of index.calculations) {
			assertCurrent(signal);
			const projection = calculation.kind === 'inline' ? calculation.expression : calculation.projection;
			const source = projection.text;
			const environment = session.createEnvironment(calculation.id);
			initialize(environment, locals, false);
			checkpoint(calculation.span.start, environment);
			const resolution = resolveCapturedReferences(input, calculation, source, session.copyBindings(environment));
			const referenceProvenance = new Map<string, ValueProvenance>();
			for (const [symbol, fullMatch] of resolution.bindingNames) {
				const occurrence = resolution.bindingReferences?.get(symbol);
				const captured = occurrence && matchingReferences(input, calculation, occurrence)[0];
				referenceProvenance.set(symbol, captured?.provenance ?? {unverified: [`Reference ${fullMatch}`], ambiguous: false});
			}
			const onReferenceRead = (name: string, value: unknown) => session.recordInput(referenceProvenance.get(name) ?? VERIFIED_PROVENANCE, value);
			const dependencies = resolution.dependencies.map(dependency => {
				const spans = sourceSpansForRange(projection, dependency.start, dependency.end);
				return {...dependency, sourceSpans: spans, start: spans[0]?.start ?? calculation.span.start, end: spans[spans.length - 1]?.end ?? calculation.span.end};
			});
			const rows: NoteRowResult[] = [];
			let transaction: RowTransaction | undefined;
			let observation: RuntimeRowObservation;
			let rowProvenance = VERIFIED_PROVENANCE;
			const begin = (source: string) => { transaction = session.beginRow(environment); observation = observeEngine(source, environment); };
			const commit = (result: unknown) => {
				transaction!.commit(result);
				rowProvenance = finishProvenance(transaction!, observation);
				transaction = undefined;
			};
			const discard = () => {
				if (!transaction) return;
				transaction.discard();
				finishProvenance(transaction, observation);
				transaction = undefined;
			};
			const record = (index: number, result: unknown, processed: string, rowProjection: SourceProjection, transparent = false) => {
				let value: unknown;
				let captureError: string | undefined;
				try { value = detachResult(result, engine); }
				catch (error: unknown) {
					captureError = `Cannot display result: ${errorMessage(error)}`;
					diagnostics.push({kind: 'presentation', message: captureError, sourceSpans: sourceSpansForRange(rowProjection, 0, rowProjection.text.length)});
				}
				rows.push({rowIndex: index, input: rowProjection.text, processedInput: processed,
					sourceSpans: sourceSpansForRange(rowProjection, 0, rowProjection.text.length), value, transparent,
					insertion: {...(captureError ? {canInsert: false, reason: captureError} : insertionEligibility(rowProvenance, result, transparent)),
						runtimeSafetyEpoch: runtimeSafetyEpoch(engine)}});
				return value;
			};
			if (calculation.kind === 'block') {
				const processed = preProcessBlockForNumeralsDirectives(resolution.sourceMap, processors);
				const processedRows = processed.processedSource.split('\n');
				const provenances = new Map<number, ValueProvenance>();
				const result = evaluateMathFromSourceStrings(processed.processedSource, environment.scope, processed.transparentLineIndexes,
					{originalRows: calculation.rows.map(row => row.projection.text), resolution, sourceMap: processed.sourceMap}, {
						runtime: engine, physicalRowCount: calculation.rows.length, onReferenceRead,
						beginRow: (_index, row) => begin(row),
						borrow: (name, value, contributors) => session.borrow(environment, name, value,
							mergeProvenance(...contributors.map(index => provenances.get(index) ?? VERIFIED_PROVENANCE))),
						commitRow: (index, result) => { commit(result); provenances.set(index, rowProvenance); checkpoint(calculation.rows[index].span.end, environment); },
						discardRow: discard, copyValue: copyPayload,
						recordResult: (index, result, transparent) => record(index, result, restoreReferenceNames(processedRows[index], resolution.bindingNames), calculation.rows[index].projection, transparent),
					});
				const diagnostic: NoteDiagnostic | undefined = result.errorMsg ? {kind: 'evaluation', message: result.errorMsg.message,
					input: result.errorInput, sourceSpans: calculation.rows[rows.length] ? [calculation.rows[rows.length].span] : [calculation.span]} : undefined;
				if (diagnostic) diagnostics.push(diagnostic);
				diagnostics.push(...processed.invalidFormatDirectives.map(item => ({kind: 'presentation' as const, message: item.message})));
				calculations.push({calculationId: calculation.id, kind: 'block', span: calculation.span, rows, dependencies, diagnostic,
					sourceMap: processed.sourceMap, formatOverrides: processed.formatOverrides,
					block: {language: calculation.language, rawRows: calculation.rows.map(row => row.projection.text), blockInfo: processed.blockInfo,
						transparentLineIndexes: processed.transparentLineIndexes,
						insertionDirectives: scanExpression(source).filter(token => token.kind === 'insertion').map(token => {
							const storedValue = token.insertion?.valueSpan;
							return {
								rowIndex: source.slice(0, token.start).split('\n').length - 1,
								expressionSpan: {start: token.start, end: token.end}, sourceSpans: sourceSpansForRange(projection, token.start, token.end), expectedText: token.text,
								storedValue: storedValue && {expressionSpan: storedValue, sourceSpans: sourceSpansForRange(projection, storedValue.start, storedValue.end),
									expectedText: source.slice(storedValue.start, storedValue.end)},
							};
						})}});
			} else {
				let diagnostic: NoteDiagnostic | undefined;
				let sourceMap = resolution.sourceMap;
				try {
					const result = evaluateInlineExpression(source, environment.scope, processors, inlinePrevious?.value, undefined, undefined, undefined, {
						runtime: engine, resolution, stableScope: true, onReferenceRead, beginRow: begin,
						borrowPrevious: value => session.borrow(environment, '__prev', copyPayload(value), inlinePrevious!.provenance),
						commitRow: commit, discardRow: discard,
					});
					sourceMap = result.sourceMap;
					record(0, result.raw, result.processedExpression, projection);
					inlinePrevious = {value: copyPayload(result.raw), provenance: rowProvenance};
					checkpoint(calculation.span.end, environment);
				} catch (error: unknown) {
					inlinePrevious = undefined;
					if (error instanceof ReferenceEvaluationError) sourceMap = error.sourceMap;
					diagnostic = {kind: 'evaluation', message: errorMessage(error), input: source, sourceSpans: sourceSpansForRange(projection, 0, source.length)};
					diagnostics.push(diagnostic);
				}
				calculations.push({calculationId: calculation.id, kind: 'inline', span: calculation.span, rows, dependencies, diagnostic, sourceMap,
					inline: {trigger: calculation.trigger, mode: calculation.mode, renderStyle: calculation.renderStyle}});
			}
		}
		assertCurrent(signal);
		const runtimeDiagnostic = runtimeSafetyDiagnostic(engine);
		if (runtimeDiagnostic) diagnostics.push({kind: 'evaluation', message: runtimeDiagnostic});
		return createNoteSnapshot({generation, calculations, diagnostics, symbols, metadataSymbols, metadataStatus: metadata.freshness.status}, engine, runtime.formatter);
	} finally { session.retire(); }
}

function resolveCapturedReferences(input: CapturedNoteEvaluationInput, calculation: CalculationSource,
	source: string, occupied: ReadonlyMap<string, unknown>): CrossNoteResolutionResult {
	if (!input.crossNoteReferencesEnabled) return {resolvedSource: source, sourceMap: originalSource(source), bindings: new Map(),
		bindingNames: new Map(), dependencies: [], referencedPaths: [], warnings: [], error: null};
	return bindCrossNoteReferences(source, input.generation.sourcePath ?? '', (reference: CrossNoteReference) => {
		const matches = matchingReferences(input, calculation, reference);
		if (matches.length > 1) return {status: 'invalid-value', error: `Conflicting captures for reference ${reference.fullMatch}.`};
		return matches[0]?.result ?? {status: 'missing-note', error: `Reference ${reference.fullMatch} was not captured for this note generation.`};
	}, occupied, input.runtime.engine);
}

function matchingReferences(input: CapturedNoteEvaluationInput, calculation: CalculationSource, reference: CrossNoteReference): readonly CapturedNoteReference[] {
	return input.references.filter(value => value.calculationId === calculation.id && value.start === reference.start && value.end === reference.end &&
		value.fullMatch === reference.fullMatch);
}

function insertionEligibility(provenance: ValueProvenance, value: unknown, transparent: boolean): NoteRowResult['insertion'] {
	if (transparent || value === undefined || typeof value === 'function') return {canInsert: false, reason: 'This row has no insertable result.'};
	if (!isVerifiedProvenance(provenance)) return {canInsert: false, reason: provenance.unverified.length
		? `Uses unverified input: ${provenance.unverified.join(', ')}.` : 'Native state changes make this result’s provenance ambiguous.'};
	return {canInsert: true};
}
function assertCurrent(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Note evaluation was superseded.'); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
import type { MathJsInstance } from 'mathjs';
