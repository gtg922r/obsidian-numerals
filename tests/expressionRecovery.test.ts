import type * as MathTypes from 'mathjs';
import { getMathRuntime } from '../src/mathRuntime';
const math = getMathRuntime();
import { App } from 'obsidian';
import { DEFAULT_SETTINGS, NumeralsScope, StringReplaceMap } from '../src/numerals.types';
import { applySourceEdits, mapSourceSpan, originalSource, scanExpression } from '../src/processing/expressionScanner';
import { normalizeExpression, preProcessBlockForNumeralsDirectives } from '../src/processing/preprocessor';
import { getScopeFromFrontmatter } from '../src/processing/scope';
import { evaluateMathFromSourceStrings } from '../src/processing/evaluator';
import { evaluateInlineExpression } from '../src/inline/inlineEvaluator';
import { evaluateMetadataValue, parseCrossNoteReferences, ReferenceEvaluationError, resolveCrossNoteReferences } from '../src/processing/crossNoteResolver';
import { cloneReferenceValue, createReferenceScope, evaluateWithReferences, restoreReferenceNames } from '../src/processing/referenceBindings';
import { cleanRawInput, extractComment } from '../src/rendering/linePreparation';
import { expressionToTeX } from '../src/rendering/texRendering';

const processors: StringReplaceMap[] = [
	// A legacy caller cannot reintroduce the old comma corruption.
	{ regex: /,(\d{3})/g, replaceStr: '$1' },
	{ regex: /\$([\d.]+)/g, replaceStr: '$1 USD', currencySymbol: '$', currencyCode: 'USD' },
];
beforeAll(() => { math.createUnit('USD'); });

function host(metadata: Record<string, unknown>, missing = new Set<string>()): App {
	return {
		metadataCache: {
			getFirstLinkpathDest: (name: string) => missing.has(name) ? null : { path: `${name}.md` },
			getFileCache: () => ({ frontmatter: metadata }),
		},
	} as unknown as App;
}
function inline(source: string, app = host({}), scope = new NumeralsScope()) {
	return evaluateInlineExpression(source, scope, processors, undefined, app, 'source.md', DEFAULT_SETTINGS);
}
function block(source: string, app = host({}), scope = new NumeralsScope()) {
	const resolution = resolveCrossNoteReferences(source, app, 'source.md', DEFAULT_SETTINGS, processors, scope);
	const processed = preProcessBlockForNumeralsDirectives(resolution.sourceMap, processors);
	const result = evaluateMathFromSourceStrings(processed.processedSource, scope, processed.transparentLineIndexes, { originalRows: processed.rawRows, resolution, sourceMap: processed.sourceMap });
	return { ...result, processed, resolution, scope };
}
function plain(value: unknown): unknown { return math.isMatrix(value) ? value.toArray() : value; }

describe('shared lexical input contract through all evaluation routes', () => {
	test.each([
		['max(1,234)', 234],
		['[max][1](1,234)', 234],
		['max?.(1,234)', 234],
		['[1,234]', [1, 234]],
		['[[1,234],[3,456]]', [[1, 234], [3, 456]]],
		['[1,234][2]', 234],
		['max(1, max(2,345))', 345],
		['1,234 + 2', 1236],
		['(1,234) + 2', 1236],
		['2 * (1,234)', 2468],
		['(1+2)(1,234)', 3702],
		['3! (1,234)', 7404],
		['max(1,2)(1,234)', 2468],
		['[2](1,234)', [2468]],
		['true(1,234)', 1234],
		["3' (1,234)", 3702],
		['1,234,567.89', 1234567.89],
		['1,234e-2', 12.34],
		['max(1,0001)', 1],
		['[1,0001]', [1, 1]],
	])('%s keeps the intended number/delimiter meaning', (source, expected) => {
		expect(plain(inline(source).raw)).toEqual(expected);
		const b = block(source); expect(b.errorMsg).toBeNull(); expect(plain(b.results[0])).toEqual(expected);
		expect(plain(evaluateMetadataValue(source, processors).result)).toEqual(expected);
		const metadata = getScopeFromFrontmatter({ numerals: 'all', value: source }, undefined, false, processors);
		expect(metadata.warnings).toEqual([]); expect(plain(metadata.scope.get('value'))).toEqual(expected);
	});

	test.each(['1,0001', '1,23', '1,234,56', '1234,567', '0,123', '1,,234', '1,234.56.7', '1,234e', '1,234.5,678', '1,234,', '$1,0001', '$1,23'])('never partially normalizes malformed %s', source => {
		expect(normalizeExpression(originalSource(source), processors).source).toBe(source);
		expect(() => inline(source)).toThrow();
		expect(block(source).errorMsg).not.toBeNull();
		expect(evaluateMetadataValue(source, processors).error).toBeDefined();
	});

	test.each(['max((1,234),5)', 'max(1 + (2,345),6)', '[1 + (2,345)]', 'A[1,234]', 'A[1](1,234)', '[max][1](1,234)', 'a.max(1,234)', 'a?.(1,234)', '(a)?.(1,234)'])('does not normalize within nested delimiter context: %s', source => {
		expect(normalizeExpression(originalSource(source), processors).source).toBe(source);
	});

	test.each(['$1,234.50', 'max($1,234.50, $2)', '[$1,234.50,$2][1]'])('explicit currency amount is a single amount: %s', source => {
		for (const value of [inline(source).raw, block(source).results[0], evaluateMetadataValue(source, processors).result]) {
			expect(math.isUnit(value)).toBe(true);
			expect((value as MathTypes.Unit).toNumber('USD')).toBe(1234.5);
		}
	});

	test.each(['"@prev @sum @total @[x::2] => $1,234.50 [[missing]].x # literal"', "'@prev [[missing]].x $1,234.50'", '"escaped \\\" @sum $1,234"'])('protects string %s across passes', source => {
		const expected = math.evaluate(source) as unknown;
		expect(normalizeExpression(originalSource(source), processors).source).toBe(source);
		expect(preProcessBlockForNumeralsDirectives(source, processors).processedSource).toBe(source);
		expect(inline(source).raw).toBe(expected);
		expect(block(source).results[0]).toBe(expected);
		expect(evaluateMetadataValue(source, processors).result).toBe(expected);
		expect(parseCrossNoteReferences(source)).toEqual([]);
		expect(cleanRawInput(source, DEFAULT_SETTINGS)).toBe(source);
		expect(extractComment(source).comment).toBeNull();
	});

	test('comments, transpose, multiline inline and directive boundaries keep mathjs meaning', () => {
		const source = '2 # @prev @sum @[x::2] => $1,234 [[missing]].x';
		expect(block(source).processed.processedSource).toBe(source);
		expect(inline(source).raw).toBe(2);
		expect(evaluateMetadataValue(source, processors).result).toBe(2);
		expect(parseCrossNoteReferences(source)).toEqual([]);
		expect(plain(inline("[1,234]' * [1,234]").raw)).toBe(54757);
		expect(inline('max(1,\n234)').raw).toBe(234);
		expect(preProcessBlockForNumeralsDirectives('@previous', []).processedSource).toBe('@previous');
		expect(block('@createUnit').processed.blockInfo.hidden_lines).toEqual([]);
		expect(block('@createUnit').errorMsg).not.toBeNull();
	});
});

describe('typed reference values and ownership', () => {
	test.each([
		[-2, '[[n]].value ^ 2', 4],
		['2 + 3i', '[[n]].value ^ 2', math.complex(-5, 12)],
		['2 cm', '[[n]].value to mm', math.evaluate('2 cm to mm') as unknown],
		['[1,234]', '[[n]].value * 2', math.matrix([2, 468])],
		['"1 + 2"', '[[n]].value', '1 + 2'],
		[true, 'not [[n]].value', false],
		['bignumber("1.234567890123456789")', '[[n]].value', math.bignumber('1.234567890123456789')],
		['fraction(1,3)', '[[n]].value', math.fraction(1, 3)],
	])('preserves type and precedence for %s', (value, source, expected) => {
		const app = host({ numerals: 'all', value });
		const b = block(source, app); expect(b.errorMsg).toBeNull();
		if (math.isUnit(expected)) {
			expect((b.results[0] as MathTypes.Unit).toNumber('mm')).toBe(20);
			expect((inline(source, app).raw as MathTypes.Unit).toNumber('mm')).toBe(20);
		} else {
			expect(b.results[0]).toEqual(expected);
			expect(inline(source, app).raw).toEqual(expected);
		}
		expect(b.processed.rawRows).toEqual([source]);
		expect(b.inputs[0]).toContain('[[n]].value');
		expect(inline(source, app).processedExpression).toContain('[[n]].value');
	});

	test.each(['[[n]].value = 3', '[[n]].value[1] = 3', '[[n]].value(x) = x', 'f([[n]].value) = 3'])('rejects reference assignment %s', source => {
		const app = host({ numerals: 'all', value: '[1,2]' });
		expect(() => inline(source, app)).toThrow(/Cannot assign/);
		const b = block(source, app); expect(b.errorMsg?.message).toMatch(/Cannot assign/); expect(b.errorInput).toBe(source);
	});

	test('typed metadata, returned matrices and mutating consumers cannot change exported values', () => {
		const matrix = math.matrix([math.complex(1, 2), 3]);
		const app = host({ numerals: 'all', value: matrix });
		const result = inline('[[n]].value', app).raw as MathTypes.Matrix;
		result.set([0], 99);
		expect(matrix.get([0])).toEqual(math.complex(1, 2));
		const scope = new NumeralsScope([['mutate', (value: MathTypes.Matrix) => { value.set([1], 99); return value; }]]);
		inline('mutate([[n]].value)', app, scope);
		expect(inline('[[n]].value[2]', app).raw).toBe(3);
		const unit = math.unit(1.2345678901234567, 'cm');
		const local = getScopeFromFrontmatter({ numerals: 'all', unit }, undefined, false, processors).scope.get('unit');
		expect(local).toEqual(unit); expect(local).not.toBe(unit);
	});

	test('functions retain their defining calculation binding table', () => {
		const scope = new NumeralsScope();
		const first = block('$f(x) = [[n]].value * x', host({ numerals: 'all', value: 2 }), scope);
		expect(first.errorMsg).toBeNull();
		const second = block('$g(x) = [[n]].value * x\n$f(3) + $g(3)', host({ numerals: 'all', value: 5 }), scope);
		expect(second.errorMsg).toBeNull(); expect(second.results[1]).toBe(21);
		expect([...scope.keys()].some(key => key.startsWith('__numerals_ref_'))).toBe(false);
	});

	test('collision checks cover original user source and caller scope; internal assignment is guarded', () => {
		const bindings = new Map([['internal', -2]]);
		const scope = new NumeralsScope([['internal', 99]]);
		expect(() => createReferenceScope(scope, bindings)).toThrow(/conflicts/);
		const protectedScope = createReferenceScope(new NumeralsScope(), bindings);
		expect(() => protectedScope.set('internal', 4)).toThrow(/Cannot assign/);
		expect(() => evaluateWithReferences('internal = 4', protectedScope, bindings)).toThrow(/Cannot assign/);
		expect(evaluateWithReferences('internal ^ 2', protectedScope, bindings)).toBe(4);
	});

	test.each([() => 42, { nested: () => 42 }, math.matrix([(() => 42) as unknown as number]), 'f(x) = x + 1'])('rejects function/object exports', value => {
		expect(() => inline('[[n]].value', host({ numerals: 'all', value }))).toThrow();
	});

	test('same-note functions, metadata opt-in, nested values and Dataview field arrays remain supported', () => {
		const local = getScopeFromFrontmatter({ numerals: 'all', '$f(x)': 'x * 2' }, undefined, false, processors);
		expect(evaluateWithReferences('$f(3)', local.scope)).toBe(6);
		expect(inline('[[n]].value', host({ value: 3, numerals: 'value' })).raw).toBe(3);
		expect(inline('[[n]].$value', host({ $value: 3, numerals: 'none' })).raw).toBe(3);
		expect(() => inline('[[n]].value', host({ value: 3 }))).toThrow(/not available/);
		expect(inline('[[n]].rates.hourly', host({ rates: { hourly: '-2' }, numerals: ['rates'] })).raw).toBe(-2);
		expect(inline('[[n]].value', host({ value: [10, 'max(1,234)'], numerals: 'all' })).raw).toBe(234);
		expect(() => cloneReferenceValue({ x: 1 })).toThrow();
	});
});

describe('dependency and source contracts', () => {
	test('collects all failures and preserves prior successful block rows; repair can recover', () => {
		const source = '2 + 2\n[[missing]].x + [[n]].absent\n[[later]].value';
		const app = host({ numerals: 'all', value: 7 }, new Set(['missing']));
		const b = block(source, app);
		expect(b.results).toEqual([4]); expect(b.errorInput).toBe('[[missing]].x + [[n]].absent');
		expect(b.resolution.dependencies.map(d => d.status)).toEqual(['missing-note', 'unavailable-property', 'resolved']);
		expect(b.resolution.referencedPaths).toEqual(['n.md', 'later.md']);
		expect(b.resolution.dependencies[0]).toMatchObject({ noteName: 'missing', sourcePath: 'source.md', start: 6, end: 19 });
		try { inline('[[missing]].x + [[n]].absent', app); throw new Error('Expected failure'); }
		catch (error) { expect(error).toBeInstanceOf(ReferenceEvaluationError); expect((error as ReferenceEvaluationError).dependencies).toHaveLength(2); }
		expect(inline('[[missing]].x + [[n]].absent', host({ numerals: 'all', x: 2, absent: 3 })).raw).toBe(5);
	});

	test('evaluation failures preserve reference dependencies and original source in diagnostics', () => {
		const source = '[[n]].value + unknown(1,234)';
		const app = host({ numerals: 'all', value: -2 });
		const b = block(source, app); expect(b.errorInput).toBe(source); expect(b.errorMsg?.message).not.toMatch(/__numerals_ref/);
		try { inline(source, app); throw new Error('Expected failure'); }
		catch (error) { expect((error as ReferenceEvaluationError).referencedPaths).toEqual(['n.md']); expect((error as ReferenceEvaluationError).originalInput).toBe(source); }
	});

	test('replacement mappings remain atomic even at equal length and after composition', () => {
		const first = applySourceEdits(originalSource('aTOKENz'), [{ start: 1, end: 6, text: 'VALUE' }]);
		expect(mapSourceSpan(first, { start: 2, end: 3 })).toEqual({ start: 1, end: 6 });
		expect(mapSourceSpan(first, { start: 2, end: 2 })).toEqual({ start: 1, end: 6 });
		expect(mapSourceSpan(first, { start: 0, end: 0 })).toEqual({ start: 0, end: 0 });
		const second = applySourceEdits(first, [{ start: 3, end: 4, text: 'longer' }]);
		expect(mapSourceSpan(second, { start: 4, end: 5 })).toEqual({ start: 1, end: 6 });
		expect(mapSourceSpan(second, { start: 0, end: 1 })).toEqual({ start: 0, end: 1 });
		expect(mapSourceSpan(second, { start: second.source.length, end: second.source.length })).toEqual({ start: 7, end: 7 });
	});

	test('maps normalized values and reference symbols to original spans with CRLF and astral text', () => {
		const source = '# 😀\r\n[[n]].value + 1,234';
		const b = block(source, host({ numerals: 'all', value: -2 }));
		const symbol = [...b.resolution.bindings.keys()][0];
		const start = b.processed.processedSource.indexOf(symbol);
		expect(mapSourceSpan(b.processed.sourceMap, { start, end: start + symbol.length })).toEqual({ start: 6, end: 17 });
		const number = b.processed.processedSource.indexOf('1234');
		expect(mapSourceSpan(b.processed.sourceMap, { start: number, end: number + 4 })).toEqual({ start: 20, end: 25 });
		expect(b.results[1]).toBe(1232);
	});

	test('TeX preserves reference labels rather than exposing symbols or replacing them with values', () => {
		const source = '[[my_note]].$value ^ 2';
		const result = inline(source, host({ $value: -2 }));
		const tex = expressionToTeX(result.processedExpression, source);
		expect(tex).toContain('my'); expect(tex).toContain('value'); expect(tex).not.toMatch(/__numerals_ref|NumeralsReferenceLabel/);
	});
});


test('scope iteration, cloning, size and forEach agree with lookup', () => {
	const outer = new NumeralsScope([['x', 3]]);
	const scoped = createReferenceScope(outer, new Map([['internal', 2]]));
	expect(scoped.size).toBe(2);
	expect([...scoped]).toEqual([['x', 3], ['internal', 2]]);
	expect([...scoped.values()]).toEqual([3, 2]);
	expect(new Map(scoped).get('x')).toBe(3);
	const seen: unknown[] = []; scoped.forEach(value => seen.push(value)); expect(seen).toEqual([3, 2]);
});

test('reference labels restore exact identifiers without cascading into strings/comments or other labels', () => {
	const names = new Map([['__numerals_ref_1', '[[a]].x'], ['__numerals_ref_10', '[[b]].x']]);
	expect(restoreReferenceNames('__numerals_ref_10 + __numerals_ref_1', names)).toBe('[[b]].x + [[a]].x');
	expect(restoreReferenceNames('"__numerals_ref_1" # __numerals_ref_10', names)).toBe('"__numerals_ref_1" # __numerals_ref_10');
});

test('quoted multiline format directives cannot change display metadata', () => {
	const source = 's="x\n@format fixed\n@decimalPlaces 3\n@format invalid\nend"';
	const processed = preProcessBlockForNumeralsDirectives(source, []);
	expect(processed.processedSource).toBe(source);
	expect(processed.transparentLineIndexes).toEqual([]);
	expect(processed.invalidFormatDirectives).toEqual([]);
	expect(processed.blockInfo.hidden_lines).toEqual([]);
	expect(processed.formatOverrides.numberFormat).toBeUndefined();
});

test('mathjs diagnostic character locations map back through reference and grouped-number edits', () => {
	const source = '[[n]].value + 1,234 + )';
	const app = host({ numerals: 'all', value: 2 });
	try { inline(source, app); throw new Error('Expected failure'); }
	catch (error) { expect((error as Error).message).toContain(`(char ${source.indexOf(')') + 1})`); }
	expect(block('1 + 1\n' + source, app).errorMsg?.message).toContain(`(char ${source.indexOf(')') + 1})`);
});


test('complete scientific currency amounts retain exponents', () => {
	for (const source of ['$1e3', '$1,000e3', 'max($1e3, $2)']) {
		const expected = source.includes('1,000') ? 1000000 : 1000;
		expect((inline(source).raw as MathTypes.Unit).toNumber('USD')).toBe(expected);
		expect((block(source).results[0] as MathTypes.Unit).toNumber('USD')).toBe(expected);
		expect((evaluateMetadataValue(source, processors).result as MathTypes.Unit).toNumber('USD')).toBe(expected);
	}
});


test('bound Map deletion and clearing have explicit immutable-reference semantics', () => {
	const outer = new NumeralsScope([['ordinary', 3]]);
	const scoped = createReferenceScope(outer, new Map([['internal', 2]]));
	expect(scoped.delete('ordinary')).toBe(true); expect(outer.has('ordinary')).toBe(false);
	expect(() => scoped.delete('internal')).toThrow(/Cannot delete/);
	expect(() => scoped.clear()).toThrow(/Cannot clear/); expect(scoped.get('internal')).toBe(2);
	const ordinary = createReferenceScope(outer, new Map()); ordinary.set('x', 2); ordinary.clear(); expect(outer.size).toBe(0);
});


test('TeX restores more than ten labels without prefix collisions', () => {
	const source = Array.from({ length: 12 }, (_, index) => `[[note${index}]].value`).join(' + ');
	const tex = expressionToTeX(source);
	for (let index = 0; index < 12; index++) expect(tex.split(`[[note${index}]].value`)).toHaveLength(2);
	expect(tex).not.toMatch(/NumeralsReferenceLabel/);
});


describe('insertion and magic directive composition', () => {
	test.each([
		['4\n@[@prev]', [4, 4], [1]],
		['1\n2\n@[@sum::3]', [1, 2, 3], [2]],
		['1\n2\n@[@total]', [1, 2, 3], [2]],
	])('unwraps then translates %s without losing source metadata', (source, expected, insertionLines) => {
		const result = block(source);
		expect(result.errorMsg).toBeNull(); expect(result.results).toEqual(expected);
		expect(result.processed.rawRows).toEqual(source.split('\n'));
		expect(cleanRawInput(source.split('\n').slice(-1)[0], DEFAULT_SETTINGS)).toBe(source.includes('@prev') ? '@prev' : source.includes('@sum') ? '@sum' : '@total');
		expect(result.processed.blockInfo.insertion_lines).toEqual(insertionLines);
		const generated = result.processed.processedSource;
		const start = generated.lastIndexOf('__');
		expect(mapSourceSpan(result.processed.sourceMap, { start, end: generated.length })).toEqual({ start: source.lastIndexOf('@['), end: source.length });
	});

	test('composed passes still protect literal strings/comments and quoted insertion values', () => {
		const source = '"@[@prev] @sum"\n# @[@total]\n@["@prev"]';
		const processed = preProcessBlockForNumeralsDirectives(source, processors);
		expect(processed.processedSource).toBe('"@[@prev] @sum"\n# @[@total]\n"@prev"');
		expect(processed.blockInfo.insertion_lines).toEqual([2]);
		expect(block(source).results).toEqual(['@[@prev] @sum', undefined, '@prev']);
	});
});
