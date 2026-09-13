import type { MathJsInstance } from 'mathjs';
import type { NoteSnapshot } from '../evaluation/noteSnapshot';
import type { NoteSourceIndex } from '../evaluation/sourceIndex';
import { isRuntimeSafetyCurrent } from '../evaluation/runtimeProvenance';
import { readInsertion } from '../processing/expressionScanner';

interface TokenChange { readonly start: number; readonly end: number; readonly expected: string; readonly replacement: string }
export interface InsertionBatch {
	readonly snapshot: NoteSnapshot;
	readonly changes: readonly TokenChange[];
	readonly after: string;
	valid(engine: MathJsInstance): boolean;
}

/** Formatting and mapping only. This helper has no editor and cannot authorize a write. */
export function prepareInsertions(snapshot: NoteSnapshot, index: NoteSourceIndex, engine: MathJsInstance): InsertionBatch | undefined {
	const source = snapshot.generation.sourceText;
	if (index.evaluationBlocked || source !== index.source.text || snapshot.generation.sourceId !== index.source.sourceId ||
		snapshot.generation.sourceRevision !== index.source.revision) return;
	const changes: TokenChange[] = [], epochs: number[] = [];
	for (const calculation of snapshot.calculations) {
		const occurrence = index.calculations.find(value => value.id === calculation.calculationId);
		if (!occurrence || occurrence.span.start !== calculation.span.start || occurrence.span.end !== calculation.span.end) return;
		for (const token of calculation.block?.insertionDirectives ?? []) {
			const row = calculation.rows.find(value => value.rowIndex === token.rowIndex);
			const epoch = row?.insertion.runtimeSafetyEpoch;
			if (!row?.insertion.canInsert || epoch === undefined || !isRuntimeSafetyCurrent(engine, epoch)) continue;
			if (token.sourceSpans.length !== 1) continue;
			const span = token.sourceSpans[0];
			if (source.slice(span.start, span.end) !== token.expectedText) continue;
			const wrapper = readInsertion(token.expectedText, 0);
			if (!wrapper || wrapper.end !== token.expectedText.length) continue;
			const formatted = snapshot.format(calculation.calculationId, row.rowIndex);
			if ('diagnostic' in formatted) continue;
			const replacement = token.expectedText.slice(0, wrapper.expressionSpan.end) + '::' + formatted.value.canonical + ']';
			const next = readInsertion(replacement, 0);
			if (!next || next.end !== replacement.length || next.expressionSpan.end !== wrapper.expressionSpan.end) continue;
			if (replacement === token.expectedText) continue;
			changes.push({...span, expected: token.expectedText, replacement}); epochs.push(epoch);
		}
	}
	if (!changes.length) return;
	changes.sort((a, b) => a.start - b.start);
	for (let i = 1; i < changes.length; i++) if (changes[i].start < changes[i - 1].end) return;
	let after = source;
	for (const change of changes.slice().reverse()) after = after.slice(0, change.start) + change.replacement + after.slice(change.end);
	return {snapshot, changes, after, valid: currentEngine => currentEngine === engine && epochs.every(epoch => isRuntimeSafetyCurrent(engine, epoch))};
}
