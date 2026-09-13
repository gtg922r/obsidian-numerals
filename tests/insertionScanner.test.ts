import { applySourceEdits, mapSourceSpan, originalSource, readInsertion, scanExpression } from '../src/processing/expressionScanner';
import { preProcessBlockForNumeralsDirectives } from '../src/processing/preprocessor';
import { createCurrencyRuntime } from '../src/settings/currencyRuntime';
import { createDefaultSettings } from '../src/settings/normalization';
import { CurrencyRegistry, createNumberFormatProfile, createResultFormatter } from '../src/formatting';
import { DEFAULT_SETTINGS, NumeralsNumberFormat, NumeralsScope } from '../src/numerals.types';
import { cleanRawInput } from '../src/rendering/linePreparation';
import { bindCrossNoteReferences, parseCrossNoteReferences } from '../src/processing/crossNoteResolver';
import { createReferenceScope, evaluateWithReferences } from '../src/processing/referenceBindings';
import { getMathRuntime } from '../src/mathRuntime';

describe('balanced result insertion spans', () => {
	test.each([
		['@[x]', 'x', undefined],
		['@ \t[x::]', 'x', ''],
		['@[ x :: 1.2300 USD ]', ' x ', ' 1.2300 USD '],
		['@[x::[1, 2]]', 'x', '[1, 2]'],
		['@[x::[[1, 2], [3, 4]]]', 'x', '[[1, 2], [3, 4]]'],
		['@[x::[[[1], [2]], [[3], [4]]]]', 'x', '[[[1], [2]], [[3], [4]]]'],
		['@[x::"a]b"]', 'x', '"a]b"'],
		[String.raw`@[x::"a\" ] b"]`, 'x', String.raw`"a\" ] b"`],
		[String.raw`@[x::"a\\"]`, 'x', String.raw`"a\\"`],
		["@[x::'a]b']", 'x', "'a]b'"],
		[String.raw`@[x::'a\' ] b']`, 'x', String.raw`'a\' ] b'`],
		['@[x::{"nested": [1, {"text": "]})::"}]}]', 'x', '{"nested": [1, {"text": "]})::"}]}'],
		['@[f(x)::f(x)]', 'f(x)', 'f(x)'],
		['@[$f(x, y)::f(x, y)]', '$f(x, y)', 'f(x, y)'],
		['@[@prev::[1, 2]]', '@prev', '[1, 2]'],
		['@[A[1]::2]', 'A[1]', '2'],
		['@[A[1:2]::[1, 2]]', 'A[1:2]', '[1, 2]'],
		['@[[[Note]].value::[1, 2]]', '[[Note]].value', '[1, 2]'],
		['@["a]b::c"::"a]b::c"]', '"a]b::c"', '"a]b::c"'],
		["@[[1, 2]'::[[1], [2]]]", "[1, 2]'", '[[1], [2]]'],
		["@[not 'a]b'::false]", "not 'a]b'", 'false'],
		["@[obj.not'::1]", "obj.not'", '1'],
		["@[℘'::1]", "℘'", '1'],
		["@[℘not'::[[1], [2]]]", "℘not'", '[[1], [2]]'],
		['@[[[Budget (draft]].value::1]', '[[Budget (draft]].value', '1'],
		['@[[[What "next]].value::1]', '[[What "next]].value', '1'],
	])('locates the complete wrapper and exact child bytes in %s', (wrapper, expression, value) => {
		const prefix = '😀 + ', source = `${prefix}${wrapper} + 4`;
		const insertion = readInsertion(source, prefix.length)!;
		expect(insertion).toBeDefined();
		expect(insertion).toMatchObject({start: prefix.length, end: prefix.length + wrapper.length});
		expect(source.slice(insertion.contentSpan.start, insertion.contentSpan.end)).toBe(wrapper.slice(wrapper.indexOf('[') + 1, -1));
		expect(source.slice(insertion.expressionSpan.start, insertion.expressionSpan.end)).toBe(expression);
		if (value === undefined) expect(insertion.valueSpan).toBeUndefined();
		else expect(source.slice(insertion.valueSpan!.start, insertion.valueSpan!.end)).toBe(value);
		const tokens = scanExpression(source).filter(token => token.kind === 'insertion');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({start: insertion.start, end: insertion.end, text: wrapper, insertion});
		expect(cleanRawInput(source, DEFAULT_SETTINGS)).toBe(`${prefix}${expression} + 4`);
	});

	test.each([
		'@[x::[1, 2]', '@[x::[[1], [2]]', '@[x::[1, 2)]', '@[x::{"a": [1, 2]]',
		'@[x::"a]b]', String.raw`@[x::"a\"]`, '@[x:(1)]', '@[::2]', '@[]',
		'@\n[x::1]', '@[x\n::1]', '@[x::[1, 2]\n]', '@[x::[1, 2]\r]', '@[x::[1, 2]\r\n]',
		'@[x::"a\nb"]', '@[x::"a\rb"]', '@[x::"a\\\nb"]',
	])('does not accept a partial or malformed wrapper: %s', source => {
		expect(readInsertion(source)).toBeUndefined();
		expect(scanExpression(source).filter(token => token.kind === 'insertion')).toEqual([]);
		expect(preProcessBlockForNumeralsDirectives(source, []).processedSource).toBe(source);
	});

	test('does not discover insertion-looking bytes in a stored string, source string or comment', () => {
		const source = '"@[not::[1]]"\n# @[not::[2]]\n@[x::"@[not::[3]] @prev => #"] = 4';
		const tokens = scanExpression(source).filter(token => token.kind === 'insertion');
		expect(tokens.map(token => token.text)).toEqual(['@[x::"@[not::[3]] @prev => #"]']);
		const processed = preProcessBlockForNumeralsDirectives(source, []);
		expect(processed.processedSource).toBe('"@[not::[1]]"\n# @[not::[2]]\nx = 4');
		expect(processed.blockInfo.insertion_lines).toEqual([2]);
	});

	test('maps unwrapping and a later @prev rewrite to the whole original token', () => {
		const wrapper = '@[@prev::[[1, 2], [3, 4]]]';
		const source = `> ${wrapper} + 1\r\n`;
		const extracted = applySourceEdits(originalSource(source), [
			{start: 0, end: 2, text: ''}, {start: source.length - 2, end: source.length - 1, text: ''},
		]);
		const processed = preProcessBlockForNumeralsDirectives(extracted, []);
		expect(processed.processedSource).toBe('__prev + 1\n');
		expect(mapSourceSpan(processed.sourceMap, {start: 0, end: 6})).toEqual({start: 2, end: 2 + wrapper.length});
		expect(mapSourceSpan(processed.sourceMap, {start: 6, end: 10})).toEqual({start: 2 + wrapper.length, end: 6 + wrapper.length});
	});

	test('keeps each wrapper independent and retains empty-value location', () => {
		const source = '@[left::[1, 2]] + @[right::]';
		const tokens = scanExpression(source).filter(token => token.kind === 'insertion');
		expect(tokens).toHaveLength(2);
		expect(tokens[1].insertion!.valueSpan).toEqual({start: source.length - 1, end: source.length - 1});
		expect(preProcessBlockForNumeralsDirectives(source, []).processedSource).toBe('left + right');
	});
});

describe('cross-note references in insertion expressions', () => {
	const math = getMathRuntime();

	test('resolves only the header and maps its bound symbol back to the complete wrapper', () => {
		const wrapper = '@[[[Note]].value::"[[Ignored]].value"]';
		const source = `2 + ${wrapper} ^ 2`;
		const reference = {start: 6, end: 6 + '[[Note]].value'.length,
			fullMatch: '[[Note]].value', noteName: 'Note', propertyPath: 'value'};
		expect(parseCrossNoteReferences(source)).toEqual([reference]);
		const resolver = jest.fn(() => ({status: 'resolved' as const, value: -2, referencedPath: 'Note.md'}));
		const resolution = bindCrossNoteReferences(source, 'Source.md', resolver, new Map(), math);
		expect(resolver).toHaveBeenCalledTimes(1);
		expect(resolver).toHaveBeenCalledWith(reference);
		expect(resolution.resolvedSource).toContain('::"[[Ignored]].value"]');
		const processed = preProcessBlockForNumeralsDirectives(resolution.sourceMap, []);
		const symbol = [...resolution.bindings.keys()][0];
		expect(processed.processedSource).toBe(`2 + ${symbol} ^ 2`);
		expect(mapSourceSpan(processed.sourceMap, {start: 4, end: 4 + symbol.length})).toEqual({start: 4, end: 4 + wrapper.length});
		const scope = createReferenceScope(new NumeralsScope(), resolution.bindings, {runtime: math});
		expect(evaluateWithReferences(processed.processedSource, scope, resolution.bindings, math)).toBe(6);
	});

	test.each(['@[[[Note]].value::[1, 2]] = 7', '@[[[Note]].value[1]::1] = 7'])('retains read-only reference bindings in %s', source => {
		const value = math.matrix([1, 2]);
		const resolution = bindCrossNoteReferences(source, 'Source.md', () => ({status: 'resolved', value}), new Map(), math);
		const processed = preProcessBlockForNumeralsDirectives(resolution.sourceMap, []);
		const scope = createReferenceScope(new NumeralsScope(), resolution.bindings, {runtime: math});
		expect(() => evaluateWithReferences(processed.processedSource, scope, resolution.bindings, math)).toThrow('Cannot assign to a cross-note reference');
		expect(value.toArray()).toEqual([1, 2]);
	});

	test('returns exact source order across expression headers and ordinary references', () => {
		const source = '[[First]].value + @[[[Second]].value + [[Third]].value::"[[Ignored]].value"] + [[Last]].value';
		expect(parseCrossNoteReferences(source)).toEqual(['First', 'Second', 'Third', 'Last'].map(noteName => {
			const fullMatch = `[[${noteName}]].value`, start = source.indexOf(fullMatch);
			return {start, end: start + fullMatch.length, fullMatch, noteName, propertyPath: 'value'};
		}));
	});

	test('keeps references in quoted headers, source strings and comments protected', () => {
		const source = '@["[[Quoted]].value"::"[[Stored]].value"] + "@[[[String]].value]" # @[[[Comment]].value]';
		expect(parseCrossNoteReferences(source)).toEqual([]);
	});

	test.each(['Budget (draft', 'What "next', "A 'quote", 'Unmatched {brace'])('keeps the reference label %s opaque while resolving the header', noteName => {
		const fullMatch = `[[${noteName}]].value`, source = `@[${fullMatch}::1] + 2`;
		expect(parseCrossNoteReferences(source)).toEqual([{start: 2, end: 2 + fullMatch.length,
			fullMatch, noteName, propertyPath: 'value'}]);
		const resolution = bindCrossNoteReferences(source, 'Source.md', () => ({status: 'resolved', value: 3}), new Map(), math);
		const processed = preProcessBlockForNumeralsDirectives(resolution.sourceMap, []);
		const scope = createReferenceScope(new NumeralsScope(), resolution.bindings, {runtime: math});
		expect(evaluateWithReferences(processed.processedSource, scope, resolution.bindings, math)).toBe(5);
	});
});

describe('existing canonical insertion bytes through preprocessing', () => {
	const currency = createCurrencyRuntime(createDefaultSettings());
	const math = currency.math;
	const formatter = createResultFormatter({runtime: math,
		currencies: CurrencyRegistry.create(currency.mappings, {runtime: math}),
		profile: createNumberFormatProfile(NumeralsNumberFormat.Fixed)});
	afterAll(() => currency.dispose());

	test.each([
		'42', '[1, 2]', '[[1, 2], [3, 4]]', '[[[1], [2]], [[3], [4]]]',
		'"a]b"', String.raw`"a\" ] b"`, '{label: "a]b", values: [1, 2]}', 'unit("1.2345$")',
	])('retains canonical %s and evaluates the complete assignment', expression => {
		const original: unknown = math.evaluate(expression);
		const canonical = formatter.format(original).canonical;
		const wrapper = `@[x::${canonical}]`, source = `${wrapper} = ${expression}`;
		const insertion = readInsertion(source)!;
		expect(source.slice(insertion.valueSpan!.start, insertion.valueSpan!.end)).toBe(canonical);
		const processed = preProcessBlockForNumeralsDirectives(source, []);
		expect(processed.processedSource).toBe(`x = ${expression}`);
		expect(processed.rawRows).toEqual([source]);
		expect(processed.blockInfo.insertion_lines).toEqual([0]);
		expect(formatter.format(math.evaluate(processed.processedSource)).canonical).toBe(canonical);
		expect(mapSourceSpan(processed.sourceMap, {start: 0, end: 1})).toEqual({start: 0, end: wrapper.length});
	});

	test('retains a function insertion signature and native function behavior', () => {
		const canonical = formatter.format(math.evaluate('f(x)=x+1')).canonical;
		expect(canonical).toBe('f(x)');
		const source = `@[f(x)::${canonical}] = x + 1\nf(2)`;
		const processed = preProcessBlockForNumeralsDirectives(source, []);
		expect(processed.processedSource).toBe('f(x) = x + 1\nf(2)');
		const result = math.evaluate(processed.processedSource) as import('mathjs').ResultSet;
		expect(result.entries[1]).toBe(3);
	});

	test('preserves matrix transpose after a mathjs letter-like identifier', () => {
		const source = "@[℘'::[[1], [2]]]";
		const processed = preProcessBlockForNumeralsDirectives(source, []);
		expect(processed.processedSource).toBe("℘'");
		const result = math.evaluate(processed.processedSource, new Map([['℘', math.matrix([[1, 2]])]])) as import('mathjs').Matrix;
		expect(result.toArray()).toEqual([[1], [2]]);
	});
});
