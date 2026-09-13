import type { MathJsInstance } from 'mathjs';
import type { FormattedResult, ResultFormatter, ResultFormatOverrides } from '../formatting/types';
import type { ReferenceDependency } from '../processing/crossNoteResolver';
import type { MappedSource } from '../processing/expressionScanner';
import type { numeralsBlockInfo } from '../numerals.types';
import type { SourceSpan } from './sourceProjection';
import type { NumeralsBlockLanguage } from './sourceIndex';
import { describeResult, detachResult, ResultDescription } from './valueOwnership';

/** The entire authoritative buffer is part of identity, even if a revision is reused. */
export interface NoteGeneration {
	readonly sourceId: string;
	readonly sourcePath?: string;
	readonly sourceRevision: string | number;
	readonly sourceText: string;
	readonly metadataRevision: string;
	readonly dependencyRevision: string;
	readonly evaluationSettingsRevision: string;
	readonly runtimeGeneration: number;
}

export interface NoteDiagnostic {
	readonly message: string;
	readonly kind: 'configuration' | 'metadata' | 'evaluation' | 'presentation';
	readonly sourceSpans?: readonly SourceSpan[];
	readonly input?: string;
}

export interface NoteRowResult {
	readonly rowIndex: number;
	readonly input: string;
	readonly processedInput: string;
	readonly sourceSpans: readonly SourceSpan[];
	readonly value: unknown;
	readonly insertion: {
		readonly canInsert: boolean;
		readonly reason?: string;
		/** Final source application must also compare this with the owning engine's live safety epoch. */
		readonly runtimeSafetyEpoch?: number;
	};
	/** Formatting-only rows are transparent to the mathematical @prev/@sum state. */
	readonly transparent?: boolean;
}

export interface IndexedInsertionDirective {
	readonly rowIndex: number;
	readonly expressionSpan: SourceSpan;
	readonly sourceSpans: readonly SourceSpan[];
	readonly expectedText: string;
	/** Exact persisted value bytes, excluding the separator and outer bracket. */
	readonly storedValue?: {
		readonly expressionSpan: SourceSpan;
		readonly sourceSpans: readonly SourceSpan[];
		readonly expectedText: string;
	};
}

export interface BlockSnapshotPresentation {
	readonly language: NumeralsBlockLanguage;
	readonly rawRows: readonly string[];
	readonly blockInfo: numeralsBlockInfo;
	readonly transparentLineIndexes: readonly number[];
	readonly insertionDirectives: readonly IndexedInsertionDirective[];
}

export interface CalculationResult {
	readonly calculationId: string;
	readonly kind: 'block' | 'inline';
	readonly span: SourceSpan;
	readonly rows: readonly NoteRowResult[];
	readonly sourceMap?: MappedSource;
	readonly dependencies: readonly SnapshotReferenceDependency[];
	readonly diagnostic?: NoteDiagnostic;
	readonly formatOverrides?: ResultFormatOverrides;
	/** Pure preprocessing output lets renderers preserve directives without rerunning math. */
	readonly block?: BlockSnapshotPresentation;
	readonly inline?: { readonly trigger: string; readonly mode: 'result' | 'equation'; readonly renderStyle: 'plain' | 'tex' };
}

/** Physical spans can be disjoint when Markdown container prefixes were removed. */
export interface SnapshotReferenceDependency extends ReferenceDependency {
	readonly sourceSpans?: readonly SourceSpan[];
}

export interface NoteSymbol {
	readonly name: string;
	readonly value: ResultDescription;
	readonly origin: 'global' | 'local';
}

/** A checkpoint contains detached descriptions, never the calculation's scope. */
export interface SymbolCheckpoint {
	readonly offset: number;
	readonly calculationId?: string;
	readonly symbols: readonly NoteSymbol[];
}

/** Record immediately after a successful row; later heap mutations must not rewrite it. */
export function recordSymbolCheckpoint(offset: number, calculationId: string | undefined,
	bindings: ReadonlyMap<string, unknown>, engine: MathJsInstance): SymbolCheckpoint {
	return {
		offset, calculationId,
		symbols: [...bindings].filter(([name]) => name !== '__prev' && name !== '__total' && !name.startsWith('__numerals_ref_')).map(([name, value]) => ({
			name, value: describeResult(value, engine), origin: name.startsWith('$') ? 'global' : 'local',
		})),
	};
}

export interface NoteSnapshotData {
	readonly generation: NoteGeneration;
	readonly calculations: readonly CalculationResult[];
	readonly diagnostics: readonly NoteDiagnostic[];
	readonly symbols: readonly SymbolCheckpoint[];
	/** Generation-owned seeds are also available for unfinished suggestion contexts. */
	readonly metadataSymbols?: readonly NoteSymbol[];
	readonly metadataStatus: 'native-ready' | 'pending' | 'unverified' | 'verified';
}

export type RowPresentation = { readonly value: FormattedResult } | { readonly diagnostic: NoteDiagnostic };

export type CalculationDescription = Omit<CalculationResult, 'rows'> & {
	readonly rows: readonly (Omit<NoteRowResult, 'value'> & { readonly result: ResultDescription })[];
};

export interface NoteSnapshot {
	readonly generation: NoteGeneration;
	readonly calculations: readonly CalculationDescription[];
	readonly diagnostics: readonly NoteDiagnostic[];
	readonly dependencies: readonly SnapshotReferenceDependency[];
	readonly metadataStatus: NoteSnapshotData['metadataStatus'];
	readonly metadataSymbols: readonly NoteSymbol[];
	/** Informational aggregate only. G must check the specific row's insertion eligibility. */
	readonly canInsert: boolean;
	symbolsAt(offset: number): readonly NoteSymbol[];
	format(calculationId: string, rowIndex: number): RowPresentation;
}

const presentationControls = new WeakMap<NoteSnapshot, (engine: MathJsInstance, formatter: ResultFormatter) => NoteSnapshot>();
const metadataControls = new WeakMap<NoteSnapshot, (engine: MathJsInstance, update: MetadataDeadlineUpdate) => NoteSnapshot>();

export interface MetadataDeadlineUpdate {
	readonly reason: string;
	readonly pendingReason?: string;
}

/** Service-only operation. The surface-facing snapshot never accepts formatter callbacks. */
export function reformatNoteSnapshot(snapshot: NoteSnapshot, engine: MathJsInstance, formatter: ResultFormatter): NoteSnapshot {
	const replace = presentationControls.get(snapshot);
	if (!replace) throw new Error('Snapshot is not owned by the note evaluation service.');
	return replace(engine, formatter);
}

/** Service-only status downgrade. The already evaluated native inputs must be unchanged. */
export function expireNoteSnapshotMetadata(snapshot: NoteSnapshot, engine: MathJsInstance,
	update: MetadataDeadlineUpdate): NoteSnapshot {
	const replace = metadataControls.get(snapshot);
	if (!replace) throw new Error('Snapshot is not owned by the note evaluation service.');
	return replace(engine, update);
}

/**
 * The backing graph lives only in this closure. Every value-bearing access returns
 * another detached graph; shallow freezes and read-only Maps cannot enforce that.
 * No populated scope or executable mathjs function is retained in a snapshot.
 */
export function createNoteSnapshot(input: NoteSnapshotData, engine: MathJsInstance,
	formatter: ResultFormatter): NoteSnapshot {
	const data = detachResult(input, engine) as NoteSnapshotData;
	const generation = Object.freeze({ ...data.generation });
	const checkpoints = [...data.symbols].sort((left, right) => left.offset - right.offset);
	const dependencies = data.calculations.flatMap(calculation => calculation.dependencies);
	const descriptions: CalculationDescription[] = data.calculations.map(calculation => ({
		...calculation, rows: calculation.rows.map(({value, ...row}) => ({ ...row, result: describeResult(value, engine) })),
	}));
	const copy = <T>(value: T): T => detachResult(value, engine) as T;
	const present = (activeFormatter: ResultFormatter, metadataStatus = data.metadataStatus,
		diagnostics = data.diagnostics): NoteSnapshot => {
		const snapshot: NoteSnapshot = Object.freeze({
		generation,
		get calculations() { return copy(descriptions); },
		get diagnostics() { return copy(diagnostics); },
		get dependencies() { return copy(dependencies); },
		metadataStatus,
		get metadataSymbols() { return copy(data.metadataSymbols ?? []); },
		canInsert: data.calculations.some(calculation => calculation.rows.some(row => row.insertion.canInsert)),
		symbolsAt(offset: number): readonly NoteSymbol[] {
			if (!Number.isInteger(offset) || offset < 0 || offset > generation.sourceText.length) {
				throw new RangeError('Symbol position is outside the authoritative source.');
			}
			const calculation = data.calculations.find(item => item.span.start <= offset && offset < item.span.end);
			const result = new Map<string, NoteSymbol>();
			// Globals follow the latest physical checkpoint. Local bindings are only
			// available within their defining occurrence, including stopped blocks.
			for (const checkpoint of checkpoints) {
				if (checkpoint.offset > offset) break;
				for (const [name, symbol] of result) {
					if (symbol.origin === 'global' || (calculation && checkpoint.calculationId === calculation.calculationId)) result.delete(name);
				}
				for (const symbol of checkpoint.symbols) {
					if (symbol.origin === 'global' || (calculation && checkpoint.calculationId === calculation.calculationId)) {
						result.set(symbol.name, symbol);
					}
				}
			}
			return copy([...result.values()]);
		},
		format(calculationId: string, rowIndex: number): RowPresentation {
			const calculation = data.calculations.find(item => item.calculationId === calculationId);
			const row = calculation?.rows.find(item => item.rowIndex === rowIndex);
			if (!calculation || !row) throw new RangeError('Unknown calculation result.');
			try {
				return { value: activeFormatter.format(copy(row.value), copy(calculation.formatOverrides)) };
			} catch (error: unknown) {
				return { diagnostic: { kind: 'presentation', message: error instanceof Error ? error.message : String(error),
					input: row.input, sourceSpans: copy(row.sourceSpans) } };
			}
		},
		});
		presentationControls.set(snapshot, (nextEngine, nextFormatter) => {
			if (nextEngine !== engine) throw new Error('Cannot format a note snapshot with a different math runtime.');
			return present(nextFormatter, metadataStatus, diagnostics);
		});
		metadataControls.set(snapshot, (nextEngine, update) => {
			if (nextEngine !== engine) throw new Error('Cannot update a note snapshot with a different math runtime.');
			if (metadataStatus !== 'pending') return snapshot;
			const nextDiagnostics = diagnostics.filter(diagnostic => diagnostic.kind !== 'metadata' ||
				(diagnostic.message !== update.pendingReason && diagnostic.message !== update.reason));
			return present(activeFormatter, 'unverified', [...nextDiagnostics, {kind: 'metadata', message: update.reason}]);
		});
		return snapshot;
	};
	return present(formatter);
}
