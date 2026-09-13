import { all, create, type MathJsInstance } from 'mathjs';
import { captureNoteEvaluationInput, evaluateNote, type NoteEvaluationRequest } from '../../src/evaluation/evaluateNote';
import { evaluateRuntimeMetadata, isRuntimeSafetyCurrent, observeRuntimeRow, recordRuntimeRow, runtimeSafetyEpoch } from '../../src/evaluation/runtimeProvenance';
import { VERIFIED_PROVENANCE } from '../../src/evaluation/provenance';
import type { NoteSnapshot } from '../../src/evaluation/noteSnapshot';
import type { App } from 'obsidian';
import type { NumeralsSettings } from '../../src/numerals.types';
import { evaluateMetadataValue, resolveSingleReference } from '../../src/processing/crossNoteResolver';

const {load: parseYaml} = jest.requireActual<{load: (text: string) => unknown}>('js-yaml');
const block = (source: string): string => `\`\`\`math\n${source}\n\`\`\``;
const inline = (source: string): string => `\`#:${source}\``;

describe('runtime-owned provenance across complete note sessions', () => {
	let engine: MathJsInstance;
	beforeEach(() => { engine = create(all); });

	function evaluate(text: string, overrides: Partial<NoteEvaluationRequest> = {}): NoteSnapshot {
		return evaluateNote(captureNoteEvaluationInput({
			generation: {sourceId: 'buffer:one', sourcePath: 'One.md', sourceRevision: 1, sourceText: text,
				metadataRevision: 'metadata:1', dependencyRevision: 'dependencies:1', evaluationSettingsRevision: 'settings:1', runtimeGeneration: 1},
			runtime: {engine, formatter: {format: value => ({text: engine.format(value), tex: engine.format(value), canonical: engine.format(value)})}},
			preProcessors: [], parseYaml, ...overrides,
		}));
	}

	function textAt(snapshot: NoteSnapshot, calculation: number): string {
		const presentation = snapshot.format(snapshot.calculations[calculation].calculationId, 0);
		if ('diagnostic' in presentation) throw new Error(presentation.diagnostic.message);
		return presentation.value.text;
	}

	const dv = {status: 'projection' as const, origin: 'inline-fields' as const, revision: 1, metadata: {$dv: 2}};

	it.each(['', '; missing'])('withholds literals after an unverified numeric configuration effect%s', suffix => {
		const snapshot = evaluate([block(`config({number:"BigNumber", precision:$dv})${suffix}`), inline('1/3'), inline('2+3')].join('\n\n'), {dataview: dv});
		expect(textAt(snapshot, 1)).toBe('0.33');
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(false);
		expect(snapshot.diagnostics.some(diagnostic => diagnostic.message.includes('Reload Numerals'))).toBe(true);
		if (suffix) expect(snapshot.calculations[0].diagnostic?.message).toContain('Undefined symbol missing');
	});

	it('retains runtime uncertainty across source revisions and different note identities', () => {
		evaluate(block('config({number:"BigNumber", precision:$dv})'), {dataview: dv});
		const epoch = runtimeSafetyEpoch(engine);
		for (const sourceId of ['buffer:one', 'buffer:two']) {
			const sourceText = inline('1/3');
			const snapshot = evaluate(sourceText, {generation: {sourceId, sourcePath: `${sourceId}.md`, sourceRevision: 2, sourceText,
				metadataRevision: 'metadata:2', dependencyRevision: 'dependencies:2', evaluationSettingsRevision: 'settings:1', runtimeGeneration: 1}});
			expect(textAt(snapshot, 0)).toBe('0.33');
			expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(false);
		}
		expect(runtimeSafetyEpoch(engine)).toBe(epoch);
	});

	it('invalidates old eligible row epochs after later engine effects and recovers only with a fresh engine', () => {
		const previous = evaluate(inline('1/3'));
		const previousRow = previous.calculations[0].rows[0];
		const oldEngine = engine;
		expect(previousRow.insertion.canInsert).toBe(true);
		expect(isRuntimeSafetyCurrent(engine, previousRow.insertion.runtimeSafetyEpoch!)).toBe(true);
		evaluate(block('config({number:"BigNumber", precision:$dv})'), {dataview: dv});
		expect(isRuntimeSafetyCurrent(engine, previousRow.insertion.runtimeSafetyEpoch!)).toBe(false);
		engine = create(all);
		const fresh = evaluate(inline('1/3'));
		expect(fresh.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
		expect(runtimeSafetyEpoch(oldEngine)).toBeGreaterThan(0);
	});

	it('invalidates earlier eligible rows in the same pass without advancing on ordinary later reads', () => {
		const snapshot = evaluate([inline('2+3'), block('config({precision:$dv})'), inline('2+3'), inline('2+3')].join('\n\n'), {dataview: dv});
		const [first, , third, fourth] = snapshot.calculations;
		expect(first.rows[0].insertion.canInsert).toBe(true);
		expect(isRuntimeSafetyCurrent(engine, first.rows[0].insertion.runtimeSafetyEpoch!)).toBe(false);
		expect(third.rows[0].insertion.runtimeSafetyEpoch).toBe(fourth.rows[0].insertion.runtimeSafetyEpoch);
		expect(isRuntimeSafetyCurrent(engine, fourth.rows[0].insertion.runtimeSafetyEpoch!)).toBe(true);
		expect(fourth.rows[0].insertion.canInsert).toBe(false);
	});

	it('keeps registry-only scalar createUnit effects separate from literal arithmetic, even after failure', () => {
		const snapshot = evaluate([block('createUnit("runtimeunit", $definition); missing'), inline('1 runtimeunit'), inline('1/3')].join('\n\n'),
			{dataview: {...dv, metadata: {$definition: '"2 m"'}}});
		expect(textAt(snapshot, 1)).toBe('1 runtimeunit');
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(true);
		const later = evaluate(inline('1/3'));
		expect(later.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(snapshot.diagnostics.some(diagnostic => diagnostic.message.includes('Unit registry state'))).toBe(true);
	});

	it('observes configuration effects inside freshly initialized and preprocessed metadata', () => {
		const text = `---\n$apply: 'CHANGE({number:"BigNumber", precision:2})'\n$after: '1/3'\n---\n${inline('$after')} ${inline('1/3')}`;
		const snapshot = evaluate(text, {preProcessors: [{regex: /CHANGE/g, replaceStr: 'config'}]});
		expect(snapshot.calculations.map(calculation => calculation.rows[0].insertion.canInsert)).toEqual([false, false]);
		expect(textAt(snapshot, 1)).toBe('0.33');
	});

	it('does not treat a createUnit token as registry-only when its argument calls a configuration closure', () => {
		const source = 'createUnit("nestedunit", $change($dv))';
		const observation = observeRuntimeRow(engine, source, new Map<string, unknown>([['$change', () => '2 m'], ['$dv', 2]]));
		expect(observation.registryOnly).toBe(false);
		const snapshot = evaluate([block('$change(x)=config({number:"BigNumber",precision:x})\ncreateUnit("nestedunit", $change($dv))'), inline('1/3')].join('\n\n'), {dataview: dv});
		expect(textAt(snapshot, 1)).toBe('0.33');
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
	});

	it('treats aliased, callback and failed opaque calls conservatively when they may change the engine', () => {
		const text = [block('$change=config\n$change({number:"BigNumber",precision:$dv}); missing'), inline('1/3'), inline('2+3')].join('\n\n');
		const snapshot = evaluate(text, {dataview: dv});
		expect(textAt(snapshot, 1)).toBe('0.33');
		expect(snapshot.calculations.slice(1).map(calculation => calculation.rows[0].insertion.canInsert)).toEqual([false, false]);
	});

	it('leaves unrelated constants eligible while unverified scalar Dataview inputs are merely present or read', () => {
		const snapshot = evaluate([inline('2+3'), inline('$dv'), inline('1/3')].join('\n\n'), {dataview: dv});
		expect(snapshot.calculations.map(calculation => calculation.rows[0].insertion.canInsert)).toEqual([true, false, true]);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('keeps literals eligible after passive opaque reads and unused engine-capable declarations or aliases', () => {
		const text = [block('$change(x)=config({number:"BigNumber",precision:$dv})\n$alias=config'), inline('$dv'), inline('1/3')].join('\n\n');
		const snapshot = evaluate(text, {dataview: {...dv, metadata: {$dv: '2 m'}}});
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('invalidates the runtime only when a deferred configuration declaration is invoked', () => {
		const snapshot = evaluate([block('$change(x)=config({number:"BigNumber",precision:x})'), inline('1/3'),
			block('$change(2)'), inline('1/3')].join('\n\n'));
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(true);
		expect(textAt(snapshot, 3)).toBe('0.33');
		expect(snapshot.calculations[3].rows[0].insertion.canInsert).toBe(false);
		expect(isRuntimeSafetyCurrent(engine, snapshot.calculations[1].rows[0].insertion.runtimeSafetyEpoch!)).toBe(false);
	});

	it('observes metadata function keys as deferred full declarations until the function actually reads Dataview', () => {
		const source = `---\n$f(x): 'CHANGE({number:"BigNumber",precision:$dv})'\n---\n${inline('1/3')}\n\n${inline('$f(0)')}\n\n${inline('1/3')}`;
		const snapshot = evaluate(source, {dataview: dv, preProcessors: [{regex: /CHANGE/g, replaceStr: 'config'}]});
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(snapshot.calculations[0].rows[0].insertion.runtimeSafetyEpoch).toBe(0);
		expect(textAt(snapshot, 2)).toBe('0.33');
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(false);
	});

	it('does not advance safety epochs for ordinary reads but does for a repeated possible effect', () => {
		const effect = observeRuntimeRow(engine, 'config({precision:2})', new Map());
		recordRuntimeRow(engine, effect, {unverified: ['Dataview precision'], ambiguous: true});
		const first = runtimeSafetyEpoch(engine);
		const ordinary = observeRuntimeRow(engine, '1/3', new Map());
		recordRuntimeRow(engine, ordinary, ordinary.input);
		expect(runtimeSafetyEpoch(engine)).toBe(first);
		recordRuntimeRow(engine, effect, {unverified: ['Dataview precision'], ambiguous: true});
		expect(runtimeSafetyEpoch(engine)).toBeGreaterThan(first);
		recordRuntimeRow(engine, observeRuntimeRow(engine, '2+3', new Map()), VERIFIED_PROVENANCE);
		expect(runtimeSafetyEpoch(engine)).toBe(first + 1);
	});

	it.each([
		['$f(x)=config({precision:x})', false],
		['$f(x)=config({precision:x});', false],
		['$f(x)=x;config({precision:2})', true],
		['$f(x)=x\nconfig({precision:2})', true],
		['$alias=config', false],
		['$unit', false],
		['$object.value=$dv', true],
		['$array[1]=$dv', true],
		['map([1],config)', true],
	] as const)('classifies potential execution in %s without evaluating it', (source, executes) => {
		expect(observeRuntimeRow(engine, source, new Map()).mayExecuteOpaque).toBe(executes);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('limits registry-only classification to unshadowed createUnit with primitive arguments and no other calls', () => {
		expect(observeRuntimeRow(engine, 'createUnit("a", $definition); missing', new Map([['$definition', '2 m']])).registryOnly).toBe(true);
		expect(observeRuntimeRow(engine, 'createUnit("a", $definition)', new Map([['$definition', engine.unit('2 m')]])).registryOnly).toBe(false);
		expect(observeRuntimeRow(engine, 'createUnit("a", "2 m")', new Map([['createUnit', () => undefined]])).registryOnly).toBe(false);
		expect(observeRuntimeRow(engine, 'createUnit("a", config({precision:2}))', new Map()).registryOnly).toBe(false);
	});

	it('tracks a native engine alias whose valid mathjs name is outside the extension scanner alphabet', () => {
		const snapshot = evaluate([block('℘=config\n℘({number:"BigNumber",precision:2})'), inline('1/3')].join('\n\n'));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(textAt(snapshot, 1)).toBe('0.33');
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
		expect(runtimeSafetyEpoch(engine)).toBeGreaterThan(0);
	});

	it.each(['config=2\nconfig+1\nf(config)=config+1\nf(2)', 'config(x)=x+1\nconfig(2)', 'config=2; config+1\nconfig+1'])('respects binding and parameter shadowing in %s', source => {
		const snapshot = evaluate(block(source));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		const final = snapshot.calculations[0].rows.at(-1)!;
		expect(final.result).toBe(3);
		expect(final.insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('respects engine-name parameter shadowing in metadata function declarations', () => {
		const snapshot = evaluate(`---\nnumerals: all\nf(config): config+1\n---\n${inline('f(2)')}`);
		expect(snapshot.calculations[0].rows[0].result).toBe(3);
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it.each([
		['config({number:"BigNumber",precision:2}).precision', 'resolved'],
		['config({number:"BigNumber",precision:2}); missing', 'invalid-value'],
		['config({number:"BigNumber",precision:2})', 'invalid-value'],
	] as const)('retains runtime effects from reference metadata even when resolution returns %s / %s', (amount, status) => {
		const app = {metadataCache: {
			getFirstLinkpathDest: () => ({path: 'Other.md'}),
			getFileCache: () => ({frontmatter: {numerals: 'all', amount}}),
		}} as unknown as App;
		const result = resolveSingleReference({fullMatch: '[[Other]].amount', noteName: 'Other', propertyPath: 'amount'},
			app, 'One.md', {forceProcessAllFrontmatter: false} as NumeralsSettings, [], engine);
		expect(result.status).toBe(status);
		if (status === 'resolved') expect(result.value).toBe(2);
		expect(runtimeSafetyEpoch(engine)).toBeGreaterThan(0);
		const snapshot = evaluate(inline('1/3'));
		expect(textAt(snapshot, 0)).toBe('0.33');
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(false);
	});

	it('observes nested reference metadata and direct metadata failures before a note session exists', () => {
		const app = {metadataCache: {
			getFirstLinkpathDest: () => ({path: 'Other.md'}),
			getFileCache: () => ({frontmatter: {numerals: 'all', prices: {amount: 'config({number:"BigNumber",precision:2}).precision'}}}),
		}} as unknown as App;
		expect(resolveSingleReference({fullMatch: '[[Other]].prices.amount', noteName: 'Other', propertyPath: 'prices.amount'},
			app, 'One.md', {} as NumeralsSettings, [], engine).status).toBe('resolved');
		const epoch = runtimeSafetyEpoch(engine);
		expect(evaluateMetadataValue('config({precision:number(3)}); missing', [], engine).error).toContain('Undefined symbol missing');
		expect(runtimeSafetyEpoch(engine)).toBeGreaterThan(epoch);
		const snapshot = evaluate(inline('1/3'));
		expect(textAt(snapshot, 0)).toBe('0.333');
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(false);
	});

	it('observes called metadata closures before accepting an otherwise valid reference value', () => {
		const app = {metadataCache: {
			getFirstLinkpathDest: () => ({path: 'Other.md'}),
			getFileCache: () => ({frontmatter: {numerals: 'all', 'setPrecision(x)': 'config({number:"BigNumber",precision:x})', amount: 'setPrecision(2).precision'}}),
		}} as unknown as App;
		expect(resolveSingleReference({fullMatch: '[[Other]].amount', noteName: 'Other', propertyPath: 'amount'},
			app, 'One.md', {} as NumeralsSettings, [], engine).value).toBe(2);
		const snapshot = evaluate(inline('1/3'));
		expect(textAt(snapshot, 0)).toBe('0.33');
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(false);
	});

	it.each([
		'false ? (config=2) : config({number:"BigNumber",precision:2})',
		'(false ? (config=2) : 0); config({number:"BigNumber",precision:2})',
		'f(x)=(x ? (config=2) : config({number:"BigNumber",precision:2})); f(false)',
	])('does not let a non-executed branch shadow a real native engine call in %s', source => {
		const snapshot = evaluate([block(source), inline('1/3')].join('\n\n'));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(textAt(snapshot, 1)).toBe('0.33');
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
	});

	it.each([
		'f(x)=config(x); holder={c:f}; holder.c({number:"BigNumber",precision:2})',
		'f(x)=config(x); [f][1]({number:"BigNumber",precision:2})',
	])('retains deferred external metadata capabilities invoked through a same-expression container: %s', source => {
		evaluateRuntimeMetadata(source, engine);
		expect(engine.config({}).precision).toBe(2);
		expect(runtimeSafetyEpoch(engine)).toBeGreaterThan(0);
		const snapshot = evaluate(inline('1/3'));
		expect(textAt(snapshot, 0)).toBe('0.33');
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(false);
	});

	it('keeps an uncalled external metadata declaration passive when stored in a container', () => {
		evaluateRuntimeMetadata('f(x)=config(x); holder={c:f}', engine);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
		const snapshot = evaluate(inline('1/3'));
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
	});

	it('does not poison a clean runtime when unused external metadata has rejected syntax', () => {
		expect(() => evaluateRuntimeMetadata('1 + )', engine)).toThrow();
		const app = {metadataCache: {
			getFirstLinkpathDest: () => ({path: 'Other.md'}),
			getFileCache: () => ({frontmatter: {numerals: 'all', amount: 2, unused: '1 + )'}}),
		}} as unknown as App;
		expect(resolveSingleReference({fullMatch: '[[Other]].amount', noteName: 'Other', propertyPath: 'amount'},
			app, 'One.md', {} as NumeralsSettings, [], engine).value).toBe(2);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
		const snapshot = evaluate(inline('1/3'));
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
	});

	it('invalidates source A conversion proposals after source B clears native conversions, across later note identities', () => {
		const sourceA = evaluate(inline('typed.convert(2,"Complex")'));
		const oldEpoch = sourceA.calculations[0].rows[0].insertion.runtimeSafetyEpoch!;
		expect(textAt(sourceA, 0)).toBe('2');
		expect(sourceA.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(oldEpoch).toBe(0);
		const sourceText = `${block('typed.clearConversions()')}\n\n${inline('typed.convert(2,"Complex")')}`;
		const sourceB = evaluate(sourceText, {generation: {sourceId: 'buffer:one', sourcePath: 'One.md', sourceRevision: 2, sourceText,
			metadataRevision: 'metadata:1', dependencyRevision: 'dependencies:1', evaluationSettingsRevision: 'settings:1', runtimeGeneration: 1}});
		expect(sourceB.calculations[0].diagnostic).toBeUndefined();
		expect(sourceB.calculations[1].diagnostic?.message).toContain('There are no conversions to Complex defined');
		expect(isRuntimeSafetyCurrent(engine, oldEpoch)).toBe(false);
		expect(sourceB.diagnostics.some(diagnostic => diagnostic.message.includes('Math runtime state'))).toBe(true);
		const laterText = inline('2+3');
		const later = evaluate(laterText, {generation: {sourceId: 'buffer:two', sourcePath: 'Two.md', sourceRevision: 3, sourceText: laterText,
			metadataRevision: 'metadata:2', dependencyRevision: 'dependencies:2', evaluationSettingsRevision: 'settings:1', runtimeGeneration: 1}});
		expect(later.calculations[0].rows[0].result).toBe(5);
		expect(later.calculations[0].rows[0].insertion.canInsert).toBe(false);
		const oldEngine = engine;
		engine = create(all);
		const fresh = evaluate(inline('typed.convert(2,"Complex")'));
		expect(textAt(fresh, 0)).toBe('2');
		expect(fresh.calculations[0].rows[0].insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
		expect(isRuntimeSafetyCurrent(oldEngine, oldEpoch)).toBe(false);
	});

	it('retains native addConversion behavior while withholding the changed result and later arithmetic', () => {
		const snapshot = evaluate([block('typed.addConversion({from:"number",to:"string",convert:f(x)="changed"})'),
			inline('typed.convert(2,"string")'), inline('2+3')].join('\n\n'));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(snapshot.calculations[1].rows[0].result).toBe('changed');
		expect(snapshot.calculations.slice(1).map(calculation => calculation.rows[0].insertion.canInsert)).toEqual([false, false]);
		expect(runtimeSafetyEpoch(engine)).toBeGreaterThan(0);
	});

	it.each([
		['clear', 'typed.clear()'],
		['clearConversions', 'typed.clearConversions()'],
		['addType', 'typed.addType({name:"safetyType",test:f(x)=false})'],
		['addTypes', 'typed.addTypes([{name:"safetyType",test:f(x)=false}])'],
		['addConversion', 'typed.addConversion({from:"number",to:"string",convert:f(x)="changed"})'],
		['addConversions', 'typed.addConversions([{from:"number",to:"string",convert:f(x)="changed"}])'],
		['removeConversion', 'typed.removeConversion(conversion)'],
	] as const)('observes the public typed.%s registry mutator without changing native execution', (method, source) => {
		engine.config({matrix: 'Array'});
		const scope = new Map<string, unknown>();
		if (method === 'removeConversion') engine.evaluate('conversion={from:"number",to:"string",convert:f(x)="changed"}; typed.addConversion(conversion)', scope);
		const before = runtimeSafetyEpoch(engine);
		expect(observeRuntimeRow(engine, source, scope).recognizedEffect).toBe(true);
		expect(() => evaluateRuntimeMetadata(source, engine, scope)).not.toThrow();
		expect(runtimeSafetyEpoch(engine)).toBeGreaterThan(before);
		expect(isRuntimeSafetyCurrent(engine, before)).toBe(false);
		if (method === 'addType' || method === 'addTypes') expect(typeof engine.typed('onlySafetyType', {safetyType: value => value})).toBe('function');
		else if (method === 'addConversion' || method === 'addConversions') expect(engine.evaluate('typed.convert(2,"string")')).toBe('changed');
		else expect(() => engine.evaluate(`typed.convert(2,"${method === 'removeConversion' ? 'string' : 'Complex'}")`)).toThrow();
	});

	it.each([
		['$holder={mutate:f(x)=typed.clearConversions()}', '$holder.mutate(0)'],
		['$holder={registry:typed}', '$holder.registry.clearConversions()'],
		['$mutate(x)=typed.clearConversions()', '$mutate(0)'],
		['$namespace=typed', '$namespace.clearConversions()'],
		['$namespace(x)=typed', '$namespace(0).clearConversions()'],
	] as const)('tracks typed mutation aliases and deferred captures from %s only when invoked', (declaration, call) => {
		const snapshot = evaluate([block(declaration), inline('2+3'), block(call), inline('typed.convert(2,"Complex")')].join('\n\n'));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(true);
		expect(snapshot.calculations[1].rows[0].insertion.runtimeSafetyEpoch).toBe(0);
		expect(snapshot.calculations[2].diagnostic).toBeUndefined();
		expect(snapshot.calculations[3].diagnostic?.message).toContain('There are no conversions to Complex defined');
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it('retains native typed mutation uncertainty when the row fails after a quoted member call', () => {
		const snapshot = evaluate([block('typed["clearConversions"](); missing'), inline('typed.convert(2,"Complex")'), inline('2+3')].join('\n\n'));
		expect(snapshot.calculations[0].diagnostic?.message).toContain('Undefined symbol missing');
		expect(snapshot.calculations[1].diagnostic?.message).toContain('There are no conversions to Complex defined');
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(false);
	});

	it('recognizes a bound native mutator by identity', () => {
		const scope = new Map<string, unknown>([['mutate', Object.getOwnPropertyDescriptor(engine.typed, 'clearConversions')!.value]]);
		expect(observeRuntimeRow(engine, 'mutate()', scope).recognizedEffect).toBe(true);
		evaluateRuntimeMetadata('mutate()', engine, scope);
		expect(() => engine.evaluate('typed.convert(2,"Complex")')).toThrow('There are no conversions to Complex defined');
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it('does not resolve computed native member expressions during observation', () => {
		const observation = observeRuntimeRow(engine, 'typed[concat("clear", "Conversions")]()', new Map());
		expect(observation.recognizedEffect).toBe(true);
		expect(observation.registryOnly).toBe(false);
		expect(engine.evaluate('typed.convert(2,"Complex")').toString()).toBe('2');
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it('tolerates a previously replaced scalar typed namespace', () => {
		engine.import({typed: 2}, {override: true});
		expect(observeRuntimeRow(engine, '2+3', new Map()).recognizedEffect).toBe(false);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it.each(['(typed)', '(((typed)))'])('keeps a parenthesized native namespace read-only: %s', namespace => {
		const source = `${namespace}.convert(2,"Complex")`;
		expect(observeRuntimeRow(engine, source, new Map()).recognizedEffect).toBe(false);
		expect(String(evaluateRuntimeMetadata(source, engine))).toBe('2');
		expect(runtimeSafetyEpoch(engine)).toBe(0);
		const snapshot = evaluate(inline(source));
		expect(textAt(snapshot, 0)).toBe('2');
		expect(snapshot.calculations[0].rows[0].insertion.canInsert).toBe(true);
	});

	it.each(['(typed)', '(((typed)))', '(namespace)', '(((namespace)))'])('retains mutation detection through namespace parentheses: %s', namespace => {
		const scope = new Map<string, unknown>([['namespace', engine.typed]]);
		const source = `${namespace}.clearConversions()`;
		expect(observeRuntimeRow(engine, source, scope).recognizedEffect).toBe(true);
		evaluateRuntimeMetadata(source, engine, scope);
		expect(() => engine.evaluate('typed.convert(2,"Complex")')).toThrow('There are no conversions to Complex defined');
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it('recognizes a native method identity through a parenthesized bound holder', () => {
		const scope = new Map<string, unknown>([['holder', {mutate: Object.getOwnPropertyDescriptor(engine.typed, 'clearConversions')!.value}]]);
		const source = '((holder)).mutate()';
		expect(observeRuntimeRow(engine, source, scope).recognizedEffect).toBe(true);
		evaluateRuntimeMetadata(source, engine, scope);
		expect(() => engine.evaluate('typed.convert(2,"Complex")')).toThrow('There are no conversions to Complex defined');
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it.each(['namespace', '(namespace)', '(((namespace)))'])('separates read-only native alias identity from its pre-existing opaque input: %s', namespace => {
		const scope = new Map<string, unknown>([['namespace', engine.typed]]);
		const observation = observeRuntimeRow(engine, `${namespace}.convert(2,"Complex")`, scope);
		expect(observation.recognizedEffect).toBe(false);
		expect(observation.deferredCapability).toBe(false);
		// Bound opaque values retain the existing conservative provenance policy.
		expect(observation.opaqueInput).toBe(true);
		expect(observation.mayExecuteOpaque).toBe(false);
	});

	it.each(['$namespace', '($namespace)', '((($namespace)))'])('retains alias ambiguity without poisoning the runtime after a proved conversion: %s', namespace => {
		const earlier = evaluate(inline('1+1'));
		const oldEpoch = earlier.calculations[0].rows[0].insertion.runtimeSafetyEpoch!;
		expect(earlier.calculations[0].rows[0].insertion.canInsert).toBe(true);
		const snapshot = evaluate([block('$namespace=typed'), inline(`${namespace}.convert(2,"Complex")`), inline('2+3')].join('\n\n'));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(textAt(snapshot, 1)).toBe('2');
		expect(snapshot.calculations[1].rows[0].insertion.canInsert).toBe(false);
		expect(snapshot.calculations[2].rows[0].insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
		expect(isRuntimeSafetyCurrent(engine, oldEpoch)).toBe(true);
	});

	it('keeps an ordinary local namespace alias conversion from poisoning later arithmetic', () => {
		const snapshot = evaluate(block('ns=typed\nns.convert(2,"Complex")\n2+3'));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(snapshot.calculations[0].rows[1].insertion.canInsert).toBe(false);
		expect(snapshot.calculations[0].rows[2].insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});

	it.each(['namespace.convert(2,"Complex")', '((namespace)).convert(value,target)', 'convert(2,"Complex")', '((holder)).convert(2,"Complex")'])(
		'keeps trusted primitive native conversion identities nonopaque: %s', source => {
			const convert: unknown = Object.getOwnPropertyDescriptor(engine.typed, 'convert')!.value;
			const scope = new Map<string, unknown>([['namespace', engine.typed], ['convert', convert], ['holder', {convert}], ['value', 2], ['target', 'Complex']]);
			expect(observeRuntimeRow(engine, source, scope).mayExecuteOpaque).toBe(false);
			expect(String(evaluateRuntimeMetadata(source, engine, scope))).toBe('2');
			expect(isRuntimeSafetyCurrent(engine, 0)).toBe(true);
			expect(evaluate(inline('2+3')).calculations[0].rows[0].insertion.canInsert).toBe(true);
		});

	it.each([
		['(2),"Complex"', '2'],
		['2,("Complex")', '2'],
		['-(2),"Complex"', '-2'],
		['+((2)),(("Complex"))', '2'],
		['(((2))),((("Complex")))', '2'],
		['((primitive)),((target))', '2'],
	] as const)('preserves old epochs and later arithmetic with transparent conversion arguments: %s', (argumentsSource, expected) => {
		const earlier = evaluate(inline('1+1'));
		const oldEpoch = earlier.calculations[0].rows[0].insertion.runtimeSafetyEpoch!;
		expect(earlier.calculations[0].rows[0].insertion.canInsert).toBe(true);
		const scope = new Map<string, unknown>([['namespace', engine.typed], ['primitive', 2], ['target', 'Complex']]);
		const source = `namespace.convert(${argumentsSource})`;
		expect(observeRuntimeRow(engine, source, scope).mayExecuteOpaque).toBe(false);
		expect(String(evaluateRuntimeMetadata(source, engine, scope))).toBe(expected);
		const snapshot = evaluate(block(`namespace=typed\nprimitive=2\ntarget="Complex"\n${source}\n2+3`));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(snapshot.calculations[0].rows[3].insertion.canInsert).toBe(false);
		expect(snapshot.calculations[0].rows[4].insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
		expect(isRuntimeSafetyCurrent(engine, oldEpoch)).toBe(true);
	});

	it.each(['namespace.convert(produce(),"Complex")', 'namespace.convert(value,"Complex")', 'namespace.convert(2)', 'holder.convert(2,"Complex")',
		'namespace.convert((produce()),"Complex")', 'namespace.convert((value),"Complex")', 'namespace.convert((1+1),"Complex")', 'namespace.convert(-(primitive),"Complex")'])(
		'retains conservative tracking for unproved conversion calls: %s', source => {
			const scope = new Map<string, unknown>([['namespace', engine.typed], ['produce', () => 2], ['value', engine.complex(2)], ['primitive', 2], ['holder', {convert: () => 2}]]);
			expect(observeRuntimeRow(engine, source, scope).mayExecuteOpaque).toBe(true);
			if (source === 'namespace.convert(2)') expect(() => evaluateRuntimeMetadata(source, engine, scope)).toThrow();
			else evaluateRuntimeMetadata(source, engine, scope);
			expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
			expect(evaluate(inline('2+3')).calculations[0].rows[0].insertion.canInsert).toBe(false);
		});

	it('does not hide a namespace mutation beside a proved native conversion', () => {
		const scope = new Map<string, unknown>([['namespace', engine.typed]]);
		evaluateRuntimeMetadata('namespace.convert(2,"Complex"); namespace.clearConversions()', engine, scope);
		expect(() => engine.evaluate('typed.convert(2,"Complex")')).toThrow('There are no conversions to Complex defined');
		expect(isRuntimeSafetyCurrent(engine, 0)).toBe(false);
	});

	it('does not clear earlier broad runtime uncertainty after a proved native conversion', () => {
		evaluateRuntimeMetadata('config({precision:2})', engine);
		const epoch = runtimeSafetyEpoch(engine);
		const scope = new Map<string, unknown>([['namespace', engine.typed]]);
		evaluateRuntimeMetadata('namespace.convert(2,"Complex")', engine, scope);
		expect(runtimeSafetyEpoch(engine)).toBe(epoch);
		expect(evaluate(inline('2+3')).calculations[0].rows[0].insertion.canInsert).toBe(false);
	});

	it.each([
		' typed.convert(2,"Complex") ',
		'$convert(x,y)=typed.convert(x,y)\n$convert(2,"Complex")',
		'f(x)=x+1\n$inc=typed("inc",{number:f})\n$inc(2)',
		'f(x)=x+1\n$inc=((typed("inc",{number:f})))\n$inc(2)',
		'f(typed)=typed+1\nf(2)',
		'typed={clearConversions:f()=2}\ntyped.clearConversions()',
	])('keeps safe typed reads, construction and shadowed bindings eligible: %s', source => {
		const snapshot = evaluate(block(source));
		expect(snapshot.calculations[0].diagnostic).toBeUndefined();
		expect(snapshot.calculations[0].rows.at(-1)?.insertion.canInsert).toBe(true);
		expect(runtimeSafetyEpoch(engine)).toBe(0);
	});
});
