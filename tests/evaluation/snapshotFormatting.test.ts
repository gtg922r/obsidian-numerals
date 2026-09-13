import type { MathJsInstance } from 'mathjs';
import { DEFAULT_SETTINGS, NumeralsNumberFormat } from '../../src/numerals.types';
import { NumeralsSettingsRuntime, type NumeralsRuntimeContext } from '../../src/settings/runtimeState';
import { createNoteSnapshot, reformatNoteSnapshot, type NoteSnapshot, type NoteSnapshotData } from '../../src/evaluation/noteSnapshot';
import { isFunctionDescription, isOwnedResultDescription } from '../../src/evaluation/valueOwnership';
import { createNumberFormatProfile, createResultFormatter, type FormattedResult, type ResultFormatOverrides } from '../../src/formatting';

function snapshot(value: unknown, context: NumeralsRuntimeContext, overrides?: ResultFormatOverrides): NoteSnapshot {
	const input: NoteSnapshotData = {
		generation: {sourceId: 'buffer:format', sourcePath: 'Functions.md', sourceRevision: 1, sourceText: 'f(x)=x+1',
			metadataRevision: '1', dependencyRevision: '1', evaluationSettingsRevision: '1', runtimeGeneration: context.currencyGeneration},
		calculations: [{calculationId: 'function', kind: 'block', span: {start: 0, end: 8}, dependencies: [], formatOverrides: overrides,
			rows: [{rowIndex: 0, input: 'f(x)=x+1', processedInput: 'f(x)=x+1', sourceSpans: [{start: 0, end: 8}], value,
				insertion: {canInsert: false, reason: 'Function display.'}}]}],
		diagnostics: [], symbols: [], metadataStatus: 'native-ready',
	};
	return createNoteSnapshot(input, context.engine, context.formatter);
}

function formatted(result: NoteSnapshot): FormattedResult {
	const presentation = result.format('function', 0);
	if ('diagnostic' in presentation) throw new Error(presentation.diagnostic.message);
	return presentation.value;
}

function assertDataOnly(value: unknown): void {
	expect(typeof value).not.toBe('function');
	if (value === null || typeof value !== 'object') return;
	expect(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype).toBe(true);
	for (const entry of Object.values(value)) assertDataOnly(entry);
}

describe('detached note results through the shared E formatter', () => {
	let owner: NumeralsSettingsRuntime;
	let context: NumeralsRuntimeContext;
	let engine: MathJsInstance;
	beforeAll(() => {
		owner = new NumeralsSettingsRuntime(() => []);
		owner.prepare({...DEFAULT_SETTINGS, numberFormat: NumeralsNumberFormat.Fixed}).activate();
		context = owner.context;
		engine = context.engine;
	});
	afterAll(() => owner.dispose());

	it('shows native function syntax after detachment without calling or exposing the function', () => {
		const fn: unknown = engine.evaluate('f(x)=x+1');
		const result = snapshot(fn, context);
		const evaluate = jest.spyOn(engine, 'evaluate');
		try {
			expect(formatted(result)).toEqual({text: 'f(x)', canonical: 'f(x)', tex: engine.parse('f(x)').toTex()});
			expect(evaluate).not.toHaveBeenCalled();
			expect(result.calculations[0].rows[0].result).toEqual({kind: 'numerals-function', syntax: 'f(x)'});
			assertDataOnly(result.calculations);
		} finally { evaluate.mockRestore(); }
	});

	it('keeps dollar-prefixed function TeX consistent with the native syntax presentation', () => {
		const fn: unknown = engine.evaluate('$f(x)=x+1');
		const expected = context.formatter.format(fn);
		expect(formatted(snapshot(fn, context))).toEqual(expected);
		expect(expected.tex).toContain('unicode');
	});

	it.each(['array', 'matrix', 'plain-object'] as const)('preserves existing native function/number/unit formatting in a %s', kind => {
		const fn: unknown = engine.evaluate('f(x)=x+1');
		const values = [fn, engine.unit(1.2345, 'gbp'), engine.unit(2.3456, 'm'), engine.bignumber('1.234567890123456789')];
		const matrix = engine.matrix();
		matrix.resize([1, values.length]);
		values.forEach((entry, index) => matrix.set([0, index], entry));
		const value = kind === 'array' ? values : kind === 'matrix' ? matrix : {values};
		for (const overrides of [undefined, {decimalPlaces: 2}, {numberFormat: NumeralsNumberFormat.Exponential, decimalPlaces: 3}]) {
			const expected = context.formatter.format(value, overrides);
			const result = snapshot(value, context, overrides);
			expect(formatted(result)).toEqual(expected);
			expect(formatted(result).text).toContain('f(x)');
			expect(formatted(result).text).not.toContain('numerals-function');
			expect(formatted(result).canonical).toContain('GBP');
			expect(formatted(result).canonical).not.toContain('gbp');
			assertDataOnly(result.calculations);
		}
	});

	it('preserves native ResultSet stringification and its existing override diagnostic', () => {
		const value = engine.evaluate('f(x)=x+1\n1.234567') as import('mathjs').ResultSet;
		const result = snapshot(value, context);
		expect(formatted(result).text).toBe(`[${String(value.entries[0])}, 1.234567]`);
		expect(formatted(result)).toEqual(context.formatter.format(value));
		for (const overrides of [{decimalPlaces: 2}, {numberFormat: NumeralsNumberFormat.Exponential, decimalPlaces: 3}]) {
			expect(() => context.formatter.format(value, overrides)).toThrow('End of matrix ] expected (char 34)');
			expect(snapshot(value, context, overrides).format('function', 0)).toMatchObject({diagnostic: {message: 'End of matrix ] expected (char 34)'}});
		}
		expect(JSON.stringify(result.calculations)).not.toContain('theTypedFn');
		assertDataOnly(result.calculations);
	});

	it('preserves exact pinned-baseline numeric ResultSet serialization under overrides', () => {
		const value: unknown = engine.evaluate('1.234567\n2.3456 gbp');
		const expected = {text: '[1.234567, 2.3456 GBP]', canonical: '[1.234567, 2.3456 GBP]',
			tex: '\\begin{bmatrix}1.234567\\\\2.3456~\\mathrm{GBP}\\end{bmatrix}'};
		for (const overrides of [undefined, {decimalPlaces: 2}, {numberFormat: NumeralsNumberFormat.Exponential, decimalPlaces: 3}]) {
			expect(formatted(snapshot(value, context, overrides))).toEqual(expected);
		}
	});

	it('preserves native nested ResultSet output or the original presentation error', () => {
		const resultSet: unknown = engine.evaluate('f(x)=x+1\n2.3456');
		const matrix = engine.matrix([[0]]);
		matrix.set([0, 0], resultSet);
		for (const value of [[resultSet], {nested: resultSet}, matrix]) {
			for (const overrides of [undefined, {decimalPlaces: 2}]) {
				const result = snapshot(value, context, overrides);
				let expected: FormattedResult;
				try { expected = context.formatter.format(value, overrides); }
				catch (error: unknown) {
					expect(result.format('function', 0)).toMatchObject({diagnostic: {message: (error as Error).message}});
					continue;
				}
				expect(formatted(result)).toEqual(expected);
				assertDataOnly(result.calculations);
			}
		}
	});

	it('keeps currency symbol, canonical code and numeric precision policies unchanged', () => {
		const amount = engine.unit(1234.567, 'gbp');
		const ordinary = snapshot(amount, context);
		expect(formatted(ordinary)).toEqual(context.formatter.format(amount));
		expect(formatted(ordinary).text).toContain('£');
		expect(formatted(ordinary).canonical).toBe('1234.57 GBP');
		const fn: unknown = engine.evaluate('f(x)=x+1');
		const mixed = snapshot([fn, amount], context, {decimalPlaces: 3});
		expect(formatted(mixed).canonical).toBe('[f(x), 1234.567 GBP]');
		expect(formatted(mixed).tex).toContain('1234.567');
	});

	it('retains the originating currency runtime when another mapping is activated', () => {
		const original = snapshot(engine.unit(2, 'gbp'), context);
		const old = formatted(original);
		const otherOwner = new NumeralsSettingsRuntime(() => []);
		try {
			otherOwner.prepare({...DEFAULT_SETTINGS, numberFormat: NumeralsNumberFormat.Fixed,
				customCurrencySymbol: {symbol: '£', currency: 'XCU', unicode: 'x00A3', name: 'custom pound'}}).activate();
			expect(formatted(original)).toEqual(old);
			expect(() => reformatNoteSnapshot(original, otherOwner.context.engine, otherOwner.context.formatter)).toThrow('different math runtime');
		} finally { otherOwner.dispose(); }
	});

	it('reformats detached function collections without evaluating source again', () => {
		const value: unknown = engine.evaluate('[f(x)=x+1, 1/3]');
		const original = snapshot(value, context);
		const nextFormatter = createResultFormatter({runtime: engine,
			profile: createNumberFormatProfile(NumeralsNumberFormat.Exponential, 'en-US', engine)});
		const evaluate = jest.spyOn(engine, 'evaluate');
		try {
			const next = reformatNoteSnapshot(original, engine, nextFormatter);
			expect(formatted(next).text).toContain('f(x)');
			expect(formatted(next).text).toContain('e-1');
			expect(formatted(original).text).not.toContain('numerals-function');
			expect(evaluate).not.toHaveBeenCalled();
		} finally { evaluate.mockRestore(); }
	});

	it('formats an internally detached unknown native result as meaningful text', () => {
		class UnknownResult { toString(): string { return 'Unavailable result'; } }
		for (const overrides of [undefined, {decimalPlaces: 2}]) {
			const result = snapshot(new UnknownResult(), context, overrides);
			const output = formatted(result);
			expect(output.text).toBe('Unavailable result');
			expect(output).toEqual(context.formatter.format(new UnknownResult(), overrides));
			expect(result.calculations[0].rows[0].result).toMatchObject({kind: 'numerals-opaque', text: 'Unavailable result'});
			assertDataOnly(result.calculations);
		}
	});

	it.each([
		{kind: 'numerals-function', syntax: 'f(x)'},
		{kind: 'numerals-opaque', type: 'Mystery', text: 'Unavailable result'},
		{kind: 'numerals-value', type: 'symbol', text: '[unsupported primitive]'},
		{kind: 'numerals-cycle'},
	])('keeps literal lookalike %j objects as ordinary data, including nested results', literal => {
		expect(isOwnedResultDescription(literal)).toBe(false);
		expect(isFunctionDescription(literal)).toBe(false);
		for (const value of [literal, [literal], {nested: [literal]}]) {
			const result = snapshot(value, context, {decimalPlaces: 2});
			const output = formatted(result);
			expect(output.text).toContain('"kind"');
			expect(output.text).toContain(literal.kind);
			expect(JSON.stringify(result.calculations[0].rows[0].result)).toContain('numerals-object');
			assertDataOnly(result.calculations);
		}
		const description = snapshot(literal, context).calculations[0].rows[0].result;
		expect(description).toEqual({kind: 'numerals-object', entries: Object.entries(literal).map(([key, value]) => ({key, value}))});
	});

	it('handles null-prototype user objects before mathjs type predicates', () => {
		const literal: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		literal.kind = 'numerals-function';
		literal.syntax = 'literal(x)';
		literal.amount = engine.unit(2, 'gbp');
		for (const value of [literal, [literal], {nested: literal}]) {
			const direct = context.formatter.format(value, {decimalPlaces: 2});
			expect(direct.text).toContain('"kind": "numerals-function"');
			expect(direct.text).toContain('2.00 GBP');
			const result = snapshot(value, context, {decimalPlaces: 2});
			expect(formatted(result)).toEqual(direct);
			assertDataOnly(result.calculations);
		}
	});

	it('distinguishes a mathjs user object from a real function in the same native matrix', () => {
		const value: unknown = engine.evaluate('[{kind: "numerals-function", syntax: "spoof(x)"}, f(x)=x+1]');
		const result = snapshot(value, context);
		expect(formatted(result).text).toBe('[{"kind": "numerals-function", "syntax": "spoof(x)"}, f(x)]');
		const description = result.calculations[0].rows[0].result;
		expect(description).toMatchObject({kind: 'numerals-matrix', entries: [
			{value: {kind: 'numerals-object', entries: [{key: 'kind', value: 'numerals-function'}, {key: 'syntax', value: 'spoof(x)'}]}},
			{value: {kind: 'numerals-function', syntax: 'f(x)'}},
		]});
	});

	it('does not expose ownership through public function descriptions or structural copies', () => {
		const result = snapshot(engine.evaluate('f(x)=x+1') as unknown, context);
		const description = result.calculations[0].rows[0].result;
		expect(description).toEqual({kind: 'numerals-function', syntax: 'f(x)'});
		expect(isOwnedResultDescription(description)).toBe(false);
		const structuralCopy = JSON.parse(JSON.stringify(description)) as unknown;
		expect(isOwnedResultDescription(structuralCopy)).toBe(false);
		expect(formatted(snapshot(structuralCopy, context)).text).toContain('"kind"');
		expect(formatted(result).text).toBe('f(x)');
	});

	it('breaks cycles in detached native containers without dumping descriptor fields', () => {
		const value: {function: unknown; self?: unknown; amount: number} = {function: engine.evaluate('f(x)=x+1'), amount: 1.234};
		value.self = value;
		const result = snapshot(value, context, {decimalPlaces: 2});
		const output = formatted(result);
		expect(output.text).toContain('f(x)');
		expect(output.text).toContain('[Circular reference]');
		expect(output.text).toContain('1.23');
		expect(output.tex).not.toContain('numerals-');
		assertDataOnly(result.calculations);
	});

	it('preserves the existing invalid-syntax fallback without executing a function', () => {
		const fn = jest.fn(() => { throw new Error('Must not run'); });
		Object.assign(fn, {syntax: 'not valid math \\ {#_$%&^~}'});
		const result = snapshot(fn, context);
		const output = formatted(result);
		expect(output.text).toBe('not valid math \\ {#_$%&^~}');
		expect(output).toEqual(context.formatter.format(fn));
		expect(fn).not.toHaveBeenCalled();
	});
});
