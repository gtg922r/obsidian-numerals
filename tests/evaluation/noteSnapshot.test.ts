import { all, create } from 'mathjs';
import { createNoteSnapshot, expireNoteSnapshotMetadata, NoteSnapshotData, recordSymbolCheckpoint, reformatNoteSnapshot } from '../../src/evaluation/noteSnapshot';

describe('note snapshots', () => {
	const engine = create(all);
	const formatter = {format: (value: unknown) => ({text: engine.format(value), tex: engine.format(value), canonical: engine.format(value)})};
	function data(value: unknown): NoteSnapshotData {
		return {
			generation: {sourceId: 'editor:1', sourcePath: 'A.md', sourceRevision: 1, sourceText: '0123456789',
				metadataRevision: '1', dependencyRevision: '1', evaluationSettingsRevision: '1', runtimeGeneration: 1},
			calculations: [{calculationId: 'A', kind: 'block', span: {start: 0, end: 5}, dependencies: [],
				rows: [{rowIndex: 0, input: 'input', processedInput: 'input', sourceSpans: [{start: 1, end: 4}], value, insertion: {canInsert: true}}]}],
			diagnostics: [], symbols: [], metadataStatus: 'native-ready',
		};
	}

	it('does not expose backing values or functions through repeated access', () => {
		const original = engine.matrix([1, 2]);
		const snapshot = createNoteSnapshot(data(original), engine, formatter);
		original.set([0], 8);
		const description = snapshot.calculations[0].rows[0].result;
		if (description && typeof description === 'object' && description.kind === 'numerals-matrix') {
			Object.assign(description.entries[0], {value: 9});
		}
		expect(snapshot.format('A', 0)).toEqual({value: {text: '[1, 2]', tex: '[1, 2]', canonical: '[1, 2]'}});
		const withFunction = createNoteSnapshot(data(engine.evaluate('[f(x)=x+1]') as unknown), engine, formatter);
		expect(withFunction.calculations[0].rows[0].result).toMatchObject({kind: 'numerals-matrix', entries: [{value: {kind: 'numerals-function'}}]});
	});

	it('exposes only data descriptions for typed values and closures nested in collections', () => {
		const payload: unknown = engine.evaluate('[unit("2 cm"), bignumber("1.234567890123456789"), {f:f(x)=x+1}]');
		const snapshot = createNoteSnapshot(data(payload), engine, formatter);
		const inspect = (value: unknown): void => {
			expect(typeof value).not.toBe('function');
			if (value === null || typeof value !== 'object') return;
			expect(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype).toBe(true);
			for (const child of Object.values(value)) inspect(child);
		};
		inspect(snapshot.calculations);
		expect(snapshot.calculations[0].rows[0]).not.toHaveProperty('value');
	});

	it('returns preceding globals and only current-calculation locals', () => {
		const input = data(1);
		const snapshot = createNoteSnapshot({...input, symbols: [
			recordSymbolCheckpoint(0, 'A', new Map([['$rate', 2], ['local', 10]]), engine),
			recordSymbolCheckpoint(4, 'A', new Map([['$rate', 3], ['local', 20]]), engine),
		]}, engine, formatter);
		expect(snapshot.symbolsAt(2)).toEqual([{name: '$rate', value: 2, origin: 'global'}, {name: 'local', value: 10, origin: 'local'}]);
		expect(snapshot.symbolsAt(7)).toEqual([{name: '$rate', value: 3, origin: 'global'}]);
		expect(() => snapshot.symbolsAt(11)).toThrow('outside');
	});

	it('removes deleted bindings from later checkpoints while keeping user underscore names', () => {
		const snapshot = createNoteSnapshot({...data(1), symbols: [
			recordSymbolCheckpoint(0, 'A', new Map([['$gone', 2], ['local', 10], ['__user', 3], ['__prev', 1]]), engine),
			recordSymbolCheckpoint(3, 'A', new Map([['__user', 4]]), engine),
		]}, engine, formatter);
		expect(snapshot.symbolsAt(2)).toContainEqual({name: '__user', value: 3, origin: 'local'});
		expect(snapshot.symbolsAt(4)).toEqual([{name: '__user', value: 4, origin: 'local'}]);
		expect(snapshot.symbolsAt(8)).toEqual([]);
	});

	it('keeps independent native rows eligible while another result depends on unverified Dataview', () => {
		const input = data(2);
		const calculation = input.calculations[0];
		const dependent = {...calculation.rows[0], rowIndex: 1, value: 9,
			insertion: {canInsert: false, reason: 'Uses an unverified Dataview field.'}};
		const snapshot = createNoteSnapshot({...input, metadataStatus: 'unverified', calculations: [
			{...calculation, rows: [...calculation.rows, dependent]},
		]}, engine, formatter);
		expect(snapshot.canInsert).toBe(true);
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(snapshot.calculations[0].rows[1].insertion).toEqual(dependent.insertion);
		expect(snapshot.format('A', 1)).toMatchObject({value: {text: '9'}});
	});

	it('reformats the same values without accepting another runtime', () => {
		const snapshot = createNoteSnapshot(data(2), engine, formatter);
		const changed = reformatNoteSnapshot(snapshot, engine, {format: () => ({text: '2.00', tex: '2.00', canonical: '2'})});
		expect(changed.format('A', 0)).toMatchObject({value: {text: '2.00'}});
		expect(snapshot.format('A', 0)).toMatchObject({value: {text: '2'}});
		expect(() => reformatNoteSnapshot(snapshot, create(all), formatter)).toThrow('different math runtime');
		expect('withPresentation' in snapshot).toBe(false);
	});

	it('reports presentation exceptions without erasing successful bindings', () => {
		const snapshot = createNoteSnapshot({...data(2), symbols: [recordSymbolCheckpoint(0, 'A', new Map([['$x', 2]]), engine)]},
			engine, {format: () => { throw new Error('bad formatter'); }});
		expect(snapshot.format('A', 0)).toMatchObject({diagnostic: {kind: 'presentation', message: 'bad formatter'}});
		expect(snapshot.symbolsAt(1)).toContainEqual({name: '$x', origin: 'global', value: 2});
	});

	it('downgrades only pending metadata through a private status control preserving typed results and eligibility', () => {
		const original = engine.matrix([1, 2]);
		const snapshot = createNoteSnapshot({...data(original), metadataStatus: 'pending', diagnostics: [
			{kind: 'metadata', message: 'waiting'}, {kind: 'evaluation', message: 'unrelated'},
		]}, engine, formatter);
		original.set([0], 9);
		const expired = expireNoteSnapshotMetadata(snapshot, engine, {pendingReason: 'waiting', reason: 'expired'});
		expect(expired).not.toBe(snapshot);
		expect(expired.generation).toBe(snapshot.generation);
		expect(expired.metadataStatus).toBe('unverified');
		expect(snapshot.metadataStatus).toBe('pending');
		expect(expired.diagnostics).toEqual([{kind: 'evaluation', message: 'unrelated'}, {kind: 'metadata', message: 'expired'}]);
		expect(expired.calculations).toEqual(snapshot.calculations);
		expect(expired.canInsert).toBe(true);
		expect(expired.format('A', 0)).toMatchObject({value: {text: '[1, 2]'}});
		expect(expireNoteSnapshotMetadata(expired, engine, {reason: 'again'})).toBe(expired);
		expect(() => expireNoteSnapshotMetadata(snapshot, create(all), {reason: 'expired'})).toThrow('different math runtime');
		expect('expireMetadata' in expired).toBe(false);
		const formatted = reformatNoteSnapshot(expired, engine, {format: () => ({text: 'latest', tex: '', canonical: ''})});
		expect(formatted.metadataStatus).toBe('unverified');
		expect(formatted.diagnostics).toEqual(expired.diagnostics);
	});
});
