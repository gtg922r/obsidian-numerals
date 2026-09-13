import { all, create, type MathJsInstance } from 'mathjs';
import { captureNoteEvaluationInput, evaluateNote, type CapturedNoteReference, type NoteEvaluationRequest } from '../../src/evaluation/evaluateNote';
import { indexNote } from '../../src/evaluation/sourceIndex';
import { parseCrossNoteReferences, type CrossNoteReference, type ResolvedReference } from '../../src/processing/crossNoteResolver';
import type { NoteSnapshot } from '../../src/evaluation/noteSnapshot';
import type { ValueProvenance } from '../../src/evaluation/provenance';
import { VERIFIED_PROVENANCE } from '../../src/evaluation/provenance';
import { activateMathRuntime, resetMathRuntime } from '../../src/mathRuntime';

const { load: parseYaml } = jest.requireActual<{ load: (text: string) => unknown }>('js-yaml');
const block = (source: string): string => `\`\`\`math\n${source}\n\`\`\``;
const inline = (source: string): string => `\`#:${source}\``;
const frontmatter = (yaml: string, body: string): string => `---\n${yaml}\n---\n${body}`;

describe('complete-note evaluation semantics', () => {
	let engine: MathJsInstance;
	beforeEach(() => { engine = create(all); });
	afterEach(() => { resetMathRuntime(); });

	function request(text: string, overrides: Partial<NoteEvaluationRequest> = {}): NoteEvaluationRequest {
		return {
			generation: { sourceId: 'buffer:note', sourcePath: 'Note.md', sourceRevision: 1, sourceText: text,
				metadataRevision: 'metadata:1', dependencyRevision: 'dependencies:1', evaluationSettingsRevision: 'settings:1', runtimeGeneration: 1 },
			runtime: { engine, formatter: { format: value => ({ text: engine.format(value), tex: engine.format(value), canonical: engine.format(value) }) } },
			preProcessors: [], parseYaml, ...overrides,
		};
	}

	function evaluate(text: string, overrides: Partial<NoteEvaluationRequest> = {}): NoteSnapshot {
		return evaluateNote(captureNoteEvaluationInput(request(text, overrides)));
	}

	function referenceInputs(text: string, resolve: (reference: CrossNoteReference, calculationIndex: number) => ResolvedReference,
		provenance?: ValueProvenance): CapturedNoteReference[] {
		const index = indexNote({sourceId: 'buffer:note', path: 'Note.md', revision: 1, text});
		return index.calculations.flatMap((calculation, calculationIndex) => {
			const source = calculation.kind === 'inline' ? calculation.expression.text : calculation.projection.text;
			return parseCrossNoteReferences(source).map(reference => ({ calculationId: calculation.id,
				start: reference.start, end: reference.end, fullMatch: reference.fullMatch, runtime: engine,
				result: resolve(reference, calculationIndex), provenance }));
		});
	}

	function textAt(snapshot: NoteSnapshot, calculation: number, row = 0): string {
		const result = snapshot.format(snapshot.calculations[calculation].calculationId, row);
		if ('diagnostic' in result) throw new Error(result.diagnostic.message);
		return result.value.text;
	}

	function inlineValues(snapshot: NoteSnapshot): unknown[] {
		return snapshot.calculations.filter(calculation => calculation.kind === 'inline').map(calculation => calculation.rows[0]?.result);
	}

	it('evaluates every physical predecessor once, including distant and identical occurrences', () => {
		const text = [block('$x=2'), 'prose\n'.repeat(400), inline('$x+1'), inline('$x+1'), block('$x=5'), inline('$x+1')].join('\n\n');
		const snapshot = evaluate(text);
		expect(snapshot.calculations).toHaveLength(5);
		expect(new Set(snapshot.calculations.map(calculation => calculation.calculationId)).size).toBe(5);
		expect(inlineValues(snapshot)).toEqual([3, 3, 6]);
		expect(snapshot.diagnostics).toEqual([]);
	});

	it('keeps defining ordinary locals and observes later dollar globals for the 14 to 16 example', () => {
		const text = [block('$rate=2\nlocal=10\n$f(x)=local+x*$rate'), inline('$f(2)'),
			block('local=999\n$rate=3'), inline('$f(2)')].join('\n\n');
		const snapshot = evaluate(text);
		expect(inlineValues(snapshot)).toEqual([14, 16]);
		expect(snapshot.diagnostics).toEqual([]);
		expect(snapshot.symbolsAt(text.length).some(symbol => symbol.name === 'local')).toBe(false);
	});

	it('keeps functions attached to their defining calculation reference table and typed values', () => {
		const text = [block('local=10\n$f(x)=local+x*[[Rate]].value'), inline('$f(2)'),
			block('local=999\n[[Rate]].value'), inline('$f(2)')].join('\n\n');
		const references = referenceInputs(text, (_reference, index) => ({status: 'resolved', referencedPath: 'Rate.md', value: index === 0 ? -2 : 999}), VERIFIED_PROVENANCE);
		const snapshot = evaluate(text, {references});
		expect(inlineValues(snapshot)).toEqual([6, 6]);
		expect(snapshot.dependencies).toHaveLength(2);
		expect(snapshot.calculations[2].rows[1].result).toBe(999);
		expect(snapshot.diagnostics).toEqual([]);
	});

	it('rolls back failed dollar assignments and functions and stops the failed block', () => {
		const text = [block('$x=1\n$f(x)=x+1\n$x=9; $f(x)=99; missing\n$mustNotRun=8'), inline('$x'), inline('$f(2)'), inline('$mustNotRun')].join('\n\n');
		const snapshot = evaluate(text);
		expect(snapshot.calculations[0].rows).toHaveLength(2);
		expect(snapshot.calculations[0].diagnostic?.input).toBe('$x=9; $f(x)=99; missing');
		expect(inlineValues(snapshot)).toEqual([1, 3, undefined]);
		expect(snapshot.calculations[3].diagnostic?.message).toContain('Undefined symbol $mustNotRun');
	});

	it('has no forward pass and removes renamed/deleted globals in the next complete generation', () => {
		const first = evaluate([inline('$future'), block('$future=2\n$gone=8'), inline('$gone')].join('\n\n'));
		expect(first.calculations[0].diagnostic?.message).toContain('Undefined symbol $future');
		expect(inlineValues(first)).toEqual([undefined, 8]);
		const text = [block('$renamed=3'), inline('$gone'), inline('$future')].join('\n\n');
		const next = evaluate(text, { generation: {...request(text).generation, sourceRevision: 2} });
		expect(inlineValues(next)).toEqual([undefined, undefined]);
		expect(next.symbolsAt(text.length).map(symbol => symbol.name)).toEqual(['$renamed']);
	});

	it('keeps the inline previous chain across intervening blocks and resets it on inline error', () => {
		const snapshot = evaluate([inline('2'), block('100\n@prev+1'), inline('@prev+3'), inline('missing'), inline('@prev'), inline('7'), inline('@prev+1')].join('\n\n'));
		expect(inlineValues(snapshot)).toEqual([2, 5, undefined, undefined, 7, 8]);
		expect(snapshot.calculations[1].rows.map(row => row.result)).toEqual([100, 101]);
		expect(snapshot.calculations[4].diagnostic?.message).toContain('no previous inline result');
	});

	it('keeps transparent format rows and physical blank/comment boundaries in block chains', () => {
		const snapshot = evaluate(block('1\n@decimalPlaces 2\n@prev+1\n@sum\n\n5\n# boundary\n@sum'));
		expect(snapshot.calculations[0].rows.map(row => row.result)).toEqual([1, undefined, 2, 3, undefined, 5, undefined, undefined]);
		expect(snapshot.calculations[0].rows[1].transparent).toBe(true);
		expect(snapshot.calculations[0].rows[1].insertion.canInsert).toBe(false);
		expect(snapshot.diagnostics).toEqual([]);
	});

	it('detaches recorded and borrowed previous collection values from later mutation', () => {
		const snapshot = evaluate([block('a=[1,2]\na[1]=9\n@prev'), inline('$object={v:1}'), inline('$object.v=9'), inline('@prev')].join('\n\n'));
		expect(textAt(snapshot, 0, 0)).toBe('[1, 2]');
		expect(snapshot.calculations[0].rows[1].result).toBe(9);
		expect(textAt(snapshot, 1)).toContain('1');
		expect(inlineValues(snapshot).slice(1)).toEqual([9, 9]);
		const previous = evaluate(block('a=[1,2]\n@prev[1]=9\na[1]'));
		expect(previous.calculations[0].rows[2].result).toBe(1);
		expect(textAt(previous, 0, 0)).toBe('[1, 2]');
	});

	it('preserves semicolon ResultSets and native captured-object behavior without promising heap rollback', () => {
		const snapshot = evaluate([block('holder={v:1}; reader(a)=read(x)=a.v+x; $read=reader(holder)\nholder.v=5\n$read(0)'),
			block('maker(a)=inner(x)=(a.v=a.v+x)\n$inc=maker({v:1})\n$inc(2)+missing'), inline('$inc(0)')].join('\n\n'));
		expect(snapshot.calculations[0].rows[0].result).toMatchObject({kind: 'numerals-collection', type: 'result-set'});
		expect(snapshot.calculations[0].rows[2].result).toBe(5);
		expect(inlineValues(snapshot)).toEqual([3]);
	});

	it('retains createUnit effects after failure and reports redeclaration collisions', () => {
		const snapshot = evaluate([block('createUnit("integrationunit", "2 m"); missing'), inline('1 integrationunit'), block('createUnit("integrationunit", "2 m")')].join('\n\n'));
		expect(textAt(snapshot, 1)).toContain('integrationunit');
		expect(snapshot.calculations[2].diagnostic?.message).toContain('already exists');
		expect(snapshot.calculations[0].diagnostic?.message).toContain('Undefined symbol missing');
	});

	it.each([
		['none', false, false], ['all', false, true], ['local', false, true], [undefined, false, false], [undefined, true, true], ['none', true, false],
	] as const)('preserves metadata opt-in %s with forceAll=%s', (policy, forceAllMetadata, ordinaryAllowed) => {
		const text = frontmatter(`${policy === undefined ? '' : `numerals: ${policy}\n`}local: 3\n$global: 4`, `${inline('$global')} ${inline('local')}`);
		const snapshot = evaluate(text, {forceAllMetadata});
		expect(inlineValues(snapshot)).toEqual([4, ordinaryAllowed ? 3 : undefined]);
	});

	it('initializes ordinary metadata/functions separately and global metadata functions once per generation', () => {
		const text = frontmatter('numerals: all\nlocal: 10\n$rate: 2\nf(x): "local+x"\n$globalFunction(x): "local+x*$rate"',
			[block('local=99\nf(1)'), inline('f(1)'), inline('$globalFunction(2)'), block('$rate=3'), inline('$globalFunction(2)')].join('\n\n'));
		const snapshot = evaluate(text);
		expect(snapshot.calculations[0].rows[1].result).toBe(100);
		expect(inlineValues(snapshot)).toEqual([11, 14, 16]);
		expect(snapshot.diagnostics).toEqual([]);
	});

	it('selects nested metadata arrays once and prioritizes current-buffer YAML over stale Dataview', () => {
		const text = frontmatter('numerals: all\nlocal: 2\nrows: [[1,2],[3,4]]', `${inline('local')} ${inline('sum(rows)')} ${inline('$extra')}`);
		const snapshot = evaluate(text, {dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {local: 999, $extra: 7}}});
		expect(inlineValues(snapshot)).toEqual([2, 7, 7]);
		expect(snapshot.calculations.map(calculation => calculation.rows[0].insertion.canInsert)).toEqual([true, true, false]);
	});

	it('retains raw root metadata without linking it to initialized values or later sessions', () => {
		const text = frontmatter('numerals: all\nrows: [[1,2],[3,4]]', [block('rows[1]=90'), inline('sum(rows)')].join('\n\n'));
		const captured = captureNoteEvaluationInput(request(text));
		const entry = captured.metadata.entries.find(value => value.key === 'rows')!;
		(entry.rawValue as number[][])[1][0] = 500;
		const first = evaluateNote(captured);
		const second = evaluateNote(captured);
		expect(inlineValues(first)).toEqual([7]);
		expect(inlineValues(second)).toEqual([7]);
		expect(entry.value).toEqual([3, 4]);
	});

	it('keeps the original once-per-seed and once-per-local metadata sampling schedule', () => {
		let samples = 0;
		engine.import({sample: () => ++samples});
		const text = frontmatter('numerals: all\n$once: "sample()"\nlocal: "sample()"', [block('$once+local'), inline('$once+local')].join('\n\n'));
		const snapshot = evaluate(text);
		expect(samples).toBe(4);
		expect(snapshot.calculations[0].rows[0].result).toBe(4);
		expect(inlineValues(snapshot)).toEqual([5]);
	});

	it('does not let ordinary metadata initialization republish dollar assignments over preceding source', () => {
		const text = frontmatter('numerals: all\nlocal: "$g=3"', [block('$g=9'), inline('$g'), inline('local')].join('\n\n'));
		const snapshot = evaluate(text);
		expect(inlineValues(snapshot)).toEqual([9, 3]);
		expect(snapshot.symbolsAt(text.length)).toContainEqual({name: '$g', value: 9, origin: 'global'});
	});

	it('keeps constant and native-only rows insertable while actual unverified DV reads and helper chains are withheld', () => {
		const snapshot = evaluate([inline('2+3'), inline('$dv'), inline('@prev+1'), inline('2 m'), block('$dv\n2\n@sum\n@prev')].join('\n\n'),
			{dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {$dv: 5}}});
		expect(snapshot.metadataStatus).toBe('unverified');
		expect(snapshot.calculations.slice(0, 4).map(calculation => calculation.rows[0].insertion.canInsert)).toEqual([true, false, false, true]);
		expect(snapshot.calculations[4].rows.map(row => row.insertion.canInsert)).toEqual([false, true, false, false]);
		expect(snapshot.calculations[0].rows[0].result).toBe(5);
	});

	it('does not disable native constants while Dataview is pending or times out unused', () => {
		for (const nowMs of [10, 1000]) {
			const snapshot = evaluate(inline('1+2'), {dataview: {status: 'pending', startedAtMs: 0, maxWaitMs: 100}, nowMs});
			expect(snapshot.metadataStatus).toBe(nowMs === 10 ? 'pending' : 'unverified');
			expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
		}
	});

	it('withholds unverified reference reads without tainting an unrelated constant row', () => {
		const text = block('1+2\n[[Other]].price+1\n2+3');
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: 4}));
		const snapshot = evaluate(text, {references});
		expect(snapshot.calculations[0].rows.map(row => row.result)).toEqual([3, 5, 5]);
		expect(snapshot.calculations[0].rows.map(row => row.insertion.canInsert)).toEqual([true, false, true]);
	});

	it('matches reference provenance to the exact value occurrence and rejects duplicate captures', () => {
		const text = inline('[[Other]].price');
		const [correct] = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: 9}));
		const stale = {...correct, fullMatch: '[[Other]].other', provenance: VERIFIED_PROVENANCE};
		const snapshot = evaluate(text, {references: [stale, correct]});
		expect(inlineValues(snapshot)).toEqual([9]);
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(false);
		const duplicate = evaluate(text, {references: [correct, {...correct, provenance: VERIFIED_PROVENANCE}]});
		expect(duplicate.calculations[0].diagnostic?.message).toContain('Conflicting captures');
	});

	it('keeps identical reference text in different rows attached to its own provenance', () => {
		const text = block('[[Other]].price\n[[Other]].price');
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: 9})).map((reference, index) => ({
			...reference, provenance: index === 0 ? VERIFIED_PROVENANCE : undefined,
		}));
		const snapshot = evaluate(text, {references});
		expect(snapshot.calculations[0].rows.map(row => row.insertion.canInsert)).toEqual([true, false]);
	});

	it('removes primitive binding provenance on a successful overwrite but preserves it across a failed overwrite', () => {
		const text = [inline('$dv'), block('$dv=8; missing'), inline('$dv'), block('$dv=5'), inline('$dv'), inline('2+3')].join('\n\n');
		const snapshot = evaluate(text, {dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {$dv: 5}}});
		expect(inlineValues(snapshot)).toEqual([5, 5, 5, 5]);
		expect(snapshot.calculations.filter(calculation => calculation.kind === 'inline').map(calculation => calculation.rows[0].insertion.canInsert))
			.toEqual([false, false, true, true]);
	});

	it('tracks captured arguments and withholds later literals after an opaque unverified call', () => {
		const text = [block('$free(x)=x+$dv\nmaker(a)=inner(x)=a+x\n$captured=maker($dv)'),
			inline('$free(1)'), block('$dv=2'), inline('$captured(1)'), inline('3+4')].join('\n\n');
		const snapshot = evaluate(text, {dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {$dv: 5}}});
		expect(inlineValues(snapshot)).toEqual([6, 6, 7]);
		expect(snapshot.calculations.filter(calculation => calculation.kind === 'inline').map(calculation => calculation.rows[0].insertion.canInsert))
			.toEqual([false, false, false]);
	});

	it('borrows reference matrices independently on each read and rejects writes to the reference itself', () => {
		const text = [block('mutate(a)=(a[1]=99)\nmutate([[Other]].values)\n[[Other]].values[1]\n[[Other]].values[1]=88\n$mustNotRun=9'),
			inline('[[Other]].values[1]')].join('\n\n');
		const sourceValue = engine.matrix([1, 2]);
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: sourceValue}), VERIFIED_PROVENANCE);
		const snapshot = evaluate(text, {references});
		expect(snapshot.calculations[0].rows.map(row => row.result).slice(1)).toEqual([99, 1]);
		expect(snapshot.calculations[0].diagnostic?.message).toContain('Cannot assign to a cross-note reference');
		expect(inlineValues(snapshot)).toEqual([1]);
		expect(sourceValue.toArray()).toEqual([1, 2]);
	});

	it('tracks unverified captures and does not falsely certify sibling closures after failed opaque mutation', () => {
		const text = [block('holder={v:1}\nreader(a)=read(x)=a.v+x\nwriter(a)=write(x)=(a.v=x)\n$read=reader(holder)\n$write=writer(holder)\n$write($dv)+missing'), inline('$read(0)'), inline('2+3')].join('\n\n');
		const snapshot = evaluate(text, {dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {$dv: 5}}});
		expect(inlineValues(snapshot)).toEqual([5, 5]);
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
		// An opaque call may also have changed numeric configuration; literals are no longer provably independent.
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(false);
	});

	it('withholds both engine-dependent results and literals after an unverified aliased effect fails', () => {
		const text = [block('$make=createUnit\n$make("uncertainunit", $definition); missing'), inline('1 uncertainunit'), inline('2+3')].join('\n\n');
		const snapshot = evaluate(text, {dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: {$definition: '"2 m"'}}});
		expect(snapshot.calculations[0].diagnostic?.message).toContain('Undefined symbol missing');
		expect(textAt(snapshot, 1)).toContain('uncertainunit');
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
		expect(snapshot.calculations[2].rows[0].result).toBe(5);
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(false);
	});

	it('repairs missing references only in a newly captured dependency generation and preserves original dependency spans', () => {
		const text = `😀\n> ${inline('[[Missing]].price ^ 2')}`;
		const missing = evaluate(text);
		expect(missing.dependencies[0]).toMatchObject({status: 'missing-note', sourcePath: 'Note.md', noteName: 'Missing', propertyPath: 'price'});
		expect(text.slice(missing.dependencies[0].start, missing.dependencies[0].end)).toBe('[[Missing]].price');
		expect(missing.dependencies[0].sourceSpans?.map(span => text.slice(span.start, span.end)).join('')).toBe('[[Missing]].price');
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Missing.md', value: -2}), VERIFIED_PROVENANCE);
		const repaired = evaluate(text, {references, generation: {...request(text).generation, dependencyRevision: 'dependencies:2'}});
		expect(inlineValues(repaired)).toEqual([4]);
		expect(missing.calculations[0].diagnostic).toBeDefined();
	});

	it('keeps transformed inline parser diagnostics attached to the original reference expression', () => {
		const expression = '[[Other]].price + )';
		const text = `😀\n> ${inline(expression)}`;
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: 4}), VERIFIED_PROVENANCE);
		const snapshot = evaluate(text, {references});
		const calculation = snapshot.calculations[0];
		expect(calculation.diagnostic?.input).toBe(expression);
		expect(calculation.diagnostic?.sourceSpans?.map(span => text.slice(span.start, span.end)).join('')).toBe(expression);
		expect(calculation.sourceMap?.originalSource).toBe(expression);
		expect(calculation.sourceMap?.source).toContain('__numerals_ref_');
		expect(calculation.diagnostic?.message).not.toContain('__numerals_ref_');
	});

	it('exposes fresh metadata symbols for unfinished suggestions without evaluating the incomplete code', () => {
		const text = frontmatter('numerals: all\nlocal: 3\n$global: 4\nf(x): "x+local"', 'Value `#: lo');
		const snapshot = evaluate(text);
		expect(snapshot.calculations).toEqual([]);
		expect(snapshot.metadataSymbols.map(symbol => symbol.name)).toEqual(expect.arrayContaining(['local', '$global', 'f']));
		expect(snapshot.metadataSymbols.find(symbol => symbol.name === 'f')?.value).toMatchObject({kind: 'numerals-function'});
		expect(snapshot.symbolsAt(text.length).map(symbol => symbol.name)).toEqual(['$global']);
	});

	it('owns source, metadata, reference and preprocessor inputs before later caller mutations', () => {
		const text = frontmatter('ignored parser payload', `${inline('$dv + $native')} ${inline('[[Other]].value[1]')} ${inline('TOKEN')}`);
		const native = {$native: 2};
		const dataview = {$dv: 3};
		const referenceValue = [7, 8];
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: referenceValue}), VERIFIED_PROVENANCE);
		const processors = [{regex: /TOKEN/g, replaceStr: '9'}];
		const original = request(text, {parseYaml: () => native, dataview: {status: 'projection', origin: 'inline-fields', revision: 1, metadata: dataview}, references, preProcessors: processors});
		const captured = captureNoteEvaluationInput(original);
		native.$native = 99; dataview.$dv = 99; referenceValue[0] = 99;
		processors[0].replaceStr = '99';
		(original.generation as {sourceText: string}).sourceText = inline('99');
		const snapshot = evaluateNote(captured);
		expect(inlineValues(snapshot)).toEqual([5, 7, 9]);
		expect(snapshot.generation.sourceText).toBe(text);
	});

	it('rejects cached executable metadata functions and keeps the captured runtime after global replacement', () => {
		const cached = engine.evaluate('f(x)=x+99') as unknown;
		const text = frontmatter('ignored parser payload', `${inline('$cached(1)')} ${inline('2 m')}`);
		const captured = captureNoteEvaluationInput(request(text, {parseYaml: () => ({$cached: cached})}));
		const replacement = create(all);
		replacement.evaluate = () => { throw new Error('wrong active runtime'); };
		replacement.parse = Object.assign(() => { throw new Error('wrong active parser'); }, replacement.parse);
		activateMathRuntime(replacement);
		const snapshot = evaluateNote(captured);
		expect(snapshot.calculations[0].diagnostic?.message).toContain('$cached');
		expect(snapshot.diagnostics.some(diagnostic => diagnostic.message.includes('executable function'))).toBe(true);
		expect(textAt(snapshot, 1)).toBe('2 m');
	});

	it('quarantines cached executable reference values while preserving independent calculations', () => {
		const text = [inline('2+3'), inline('[[Other]].cached(1)'), inline('7+1')].join('\n\n');
		const cached = engine.evaluate('f(x)=x+99') as unknown;
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: cached}), VERIFIED_PROVENANCE);
		const snapshot = evaluate(text, {references});
		expect(inlineValues(snapshot)).toEqual([5, undefined, 8]);
		expect(snapshot.dependencies[0].status).toBe('invalid-value');
		expect(snapshot.calculations[1].diagnostic?.message).toContain('executable function');
	});

	it('rejects references captured under another math runtime without losing independent calculations', () => {
		const text = [inline('[[Other]].amount'), inline('2+3')].join('\n\n');
		const replacement = create(all);
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: replacement.unit('2 m')}), VERIFIED_PROVENANCE)
			.map(reference => ({...reference, runtime: replacement}));
		const snapshot = evaluate(text, {references});
		expect(inlineValues(snapshot)).toEqual([undefined, 5]);
		expect(snapshot.dependencies[0].status).toBe('invalid-value');
		expect(snapshot.calculations[0].diagnostic?.message).toContain('different math runtime');
	});

	it('does not bind an equal-length changed reference by occurrence offsets alone', () => {
		const text = inline('[[Other]].price');
		const references = referenceInputs(text, () => ({status: 'resolved', referencedPath: 'Other.md', value: 99}), VERIFIED_PROVENANCE)
			.map(reference => ({...reference, fullMatch: '[[Other]].other'}));
		const snapshot = evaluate(text, {references});
		expect(inlineValues(snapshot)).toEqual([undefined]);
		expect(snapshot.dependencies[0].status).toBe('missing-note');
		expect(snapshot.calculations[0].diagnostic).toBeDefined();
	});

	it.each(['configuration', 'parser', 'quoted-tab', 'unclosed-quote'] as const)('honors the %s guard before accessing any engine API, formatter, or metadata callback', guard => {
		const engineAccess = jest.fn((property: string | symbol) => { throw new Error(`Unexpected engine access: ${String(property)}`); });
		const inaccessibleEngine = new Proxy({} as MathJsInstance, {get: (_target, property) => engineAccess(property)});
		const parse = jest.fn(parseYaml);
		const format = jest.fn(() => { throw new Error('Unexpected formatting'); });
		const body = {
			configuration: inline('$x'),
			parser: '>\t- ```text\n>\t  `#: $leaked=99`\n>\t  ```\n\n`#:2`',
			'quoted-tab': '>\t```math\n>\t$leaked=99\n>\t```\n\n`#:$leaked`',
			'unclosed-quote': '> ```text\n> content\noutside `#:$leaked=99`',
		}[guard];
		const text = frontmatter('$x: 2\n$f(x): x+1', body);
		const captured = captureNoteEvaluationInput(request(text, {parseYaml: parse,
			runtime: {engine: inaccessibleEngine, formatter: {format}, configurationError: guard === 'configuration' ? 'Fix currency settings' : undefined},
		}));
		const snapshot = evaluateNote(captured);
		expect(snapshot.calculations).toEqual([]);
		expect(parse).not.toHaveBeenCalled();
		expect(engineAccess).not.toHaveBeenCalled();
		expect(format).not.toHaveBeenCalled();
		expect(snapshot.diagnostics.length).toBeGreaterThan(0);
		if (guard === 'configuration') expect(snapshot.diagnostics[0]).toMatchObject({kind: 'configuration', message: 'Fix currency settings'});
		else expect(captured.index.evaluationBlocked).toBe(true);
	});
});
