import { App } from 'obsidian';
import { createCurrencyPreProcessors } from '../src/settings/currencies';
import { createCurrencyRuntime } from '../src/settings/currencyRuntime';
import { createDefaultSettings, customCurrency } from '../src/settings/normalization';
import { activateMathRuntime, resetMathRuntime } from '../src/mathRuntime';
import { mapSourceSpan, originalSource } from '../src/processing/expressionScanner';
import { normalizeExpression } from '../src/processing/preprocessor';
import { evaluateMathFromSourceStrings } from '../src/processing/evaluator';
import { evaluateInlineExpression } from '../src/inline/inlineEvaluator';
import { evaluateMetadataValue } from '../src/processing/crossNoteResolver';
import { NumeralsScope } from '../src/numerals.types';

const settings = createDefaultSettings();
settings.customCurrencySymbol = customCurrency('𞋿', 'BTC');
const runtime = createCurrencyRuntime(settings);
const processors = createCurrencyPreProcessors(runtime.mappings);
const app = {} as App;
beforeAll(() => activateMathRuntime(runtime.math));
afterAll(() => { runtime.dispose(); resetMathRuntime(); });

it.each([
	['$1.2e3', 'USD', 1200], ['1.2e3$', 'USD', 1200], ['1.2e3 $', 'USD', 1200],
	['max(1234.50$, 2$)', 'USD', 1234.5], ['[1234.50$,2$][1]', 'USD', 1234.5],
	['2 USD to $', 'USD', 2], ['unit("1$")', 'USD', 1], ['unit(1,"$")', 'USD', 1],
	['1$/h', 'USD/h', 1], ['unit("1$/h")', 'USD/h', 1],
	['𞋿1.25e2', 'BTC', 125], ['1.25e2𞋿', 'BTC', 125], ['2 BTC to 𞋿', 'BTC', 2],
])('evaluates %s consistently in block, inline and metadata routes', (source, unit, expected) => {
	const normalized = normalizeExpression(originalSource(source), processors);
	const block = evaluateMathFromSourceStrings(normalized.source, new NumeralsScope());
	expect(block.errorMsg).toBeNull();
	const inline = evaluateInlineExpression(source, new NumeralsScope(), processors, undefined, app, 'note.md', settings);
	const metadata = evaluateMetadataValue(source, processors);
	expect(metadata.error).toBeUndefined();
	for (const value of [block.results[0], inline.raw, metadata.result]) {
		expect(runtime.math.isUnit(value)).toBe(true);
		if (runtime.math.isUnit(value)) expect(value.toNumber(unit)).toBe(expected);
	}
});

it('keeps native quoted conversion targets and all protected source text intact', () => {
	const source = 'number(1 USD,"$")';
	expect(normalizeExpression(originalSource(source), processors).source).toBe(source);
	expect(runtime.math.evaluate(source)).toBe(1);
	for (const source of ['"1,23$"', "'𞋿1,23'", '# $12 and 12$', '[[𞋿1$]].$price', '$price + $tax', 'obj.$price', 'foo€ = 2', 'foo𞋿 + 2', 'foo€12', 'profit$123', '€€', '££', '€£', '$1foo']) {
		expect(normalizeExpression(originalSource(source), processors).source).toBe(source);
	}
});

it.each(['1,23$', '1,,234$', '1,234.56.7$', '1,234e+$', '$1,234e+', '𞋿1,23', '1,23𞋿'])('never partially normalizes malformed %s', source => {
	expect(normalizeExpression(originalSource(source), processors).source).toBe(source);
});

it.each(['1,234.50$', '1,234.50 $', '𞋿12', '12𞋿', '𞋿'])('maps replacement diagnostics to the whole original %s token', token => {
	const source = `2 + ${token} + 3`;
	const mapped = normalizeExpression(originalSource(source), processors);
	const replacement = mapped.mappings.find(m => m.kind === 'replacement')!;
	expect(mapSourceSpan(mapped, { start: replacement.generated.start + 1, end: replacement.generated.start + 1 }))
		.toEqual({ start: 4, end: 4 + token.length });
});

it('preserves argument, array and index commas before suffix symbols', () => {
	for (const source of ['[1,234$]', 'f(1,234$)', 'A[1,234$]']) {
		expect(normalizeExpression(originalSource(source), processors).source).toBe(source.replace('$', 'USD'));
	}
	expect(runtime.math.evaluate(normalizeExpression(originalSource('size([1,234$])'), processors).source)).toEqual([2]);
});

it('preserves unconfigured suffix placement for native unit parsing', () => {
	for (const source of ['1$', '1 €', '1𞋿']) expect(normalizeExpression(originalSource(source)).source).toBe(source);
	expect(normalizeExpression(originalSource('1,234$')).source).toBe('1234$');
});

it.each([
	'x = {$: 2}; x["$"]', 'x = {$: 2}; x.$',
	'x = {€: 2}; x["€"]', 'x = {€: 2}; x.€',
	'x = {USD: 8, $: 2}; x.$', 'x = {$: 2}; x?.$',
	'x = {𞋿: 2}; x.𞋿', 'x = {$1: 2}; x.$1',
	'x = {nested: {$: 2}}; x.nested.$',
	'x = {unused: 8, # property comment\n$: 2}; x.$',
])('preserves currency symbols used as native property names: %s', source => {
	const normalized = normalizeExpression(originalSource(source), processors);
	expect(normalized.source).toBe(source);
	expect(normalized.mappings.every(mapping => mapping.kind === 'identity')).toBe(true);
	const native: unknown = runtime.math.evaluate(source);
	expect(runtime.math.format(native)).toBe('[2]');
	const block = evaluateMathFromSourceStrings(normalized.source, new NumeralsScope());
	// The legacy block adapter evaluates rows separately; multiline object parsing belongs to F.
	if (!source.includes('\n')) {
		expect(block.errorMsg).toBeNull();
		expect(runtime.math.format(block.results[0])).toBe('[2]');
	}
	const inline = evaluateInlineExpression(source, new NumeralsScope(), processors, undefined, app, 'note.md', settings);
	expect(runtime.math.format(inline.raw)).toBe('[2]');
});

it('still normalizes currency values and conversion targets inside objects', () => {
	const source = 'x = {$: $2, €: 3 EUR to €}; [x.$, x.€]';
	expect(normalizeExpression(originalSource(source), processors).source).toBe('x = {$: 2 USD, €: 3 EUR to EUR}; [x.$, x.€]');
	const result: unknown = runtime.math.evaluate(normalizeExpression(originalSource(source), processors).source);
	expect(runtime.math.format(result)).toBe('[[2 USD, 3 EUR]]');
});
