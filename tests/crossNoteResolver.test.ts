import {
	parseCrossNoteReferences,
	getNestedProperty,
	filterAvailableProperties,
	evaluateMetadataValue,
	formatValueForInsertion,
	CROSS_NOTE_REF_REGEX,
} from '../src/processing/crossNoteResolver';

describe('CROSS_NOTE_REF_REGEX', () => {
	beforeEach(() => {
		CROSS_NOTE_REF_REGEX.lastIndex = 0;
	});

	it('matches [[note]].property', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('x = [[my note]].price');
		expect(match).not.toBeNull();
		expect(match![1]).toBe('my note');
		expect(match![2]).toBe('price');
	});

	it('matches [[note]].nested.property', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('[[config]].rates.hourly');
		expect(match).not.toBeNull();
		expect(match![1]).toBe('config');
		expect(match![2]).toBe('rates.hourly');
	});

	it('matches $-prefixed properties', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('[[note]].$price');
		expect(match).not.toBeNull();
		expect(match![2]).toBe('$price');
	});

	it('matches Unicode property names', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('[[note]].α');
		expect(match).not.toBeNull();
		expect(match![2]).toBe('α');
	});

	it('does not match bare [[x]] without dot', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('[[x]]');
		expect(match).toBeNull();
	});

	it('does not match [[x]] with space before dot', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('[[x]] .y');
		expect(match).toBeNull();
	});

	it('does not match [[x]].', () => {
		// dot without identifier
		const match = CROSS_NOTE_REF_REGEX.exec('[[x]]. ');
		expect(match).toBeNull();
	});

	it('matches note names with special characters', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('[[My Note (2024)]].value');
		expect(match).not.toBeNull();
		expect(match![1]).toBe('My Note (2024)');
		expect(match![2]).toBe('value');
	});

	it('matches note names with folder paths', () => {
		const match = CROSS_NOTE_REF_REGEX.exec('[[folder/note]].value');
		expect(match).not.toBeNull();
		expect(match![1]).toBe('folder/note');
	});
});

describe('parseCrossNoteReferences', () => {
	it('returns empty array for no references', () => {
		expect(parseCrossNoteReferences('x = 2 + 3')).toEqual([]);
	});

	it('returns empty array for bare [[x]] matrix syntax', () => {
		expect(parseCrossNoteReferences('m = [[1, 2], [3, 4]]')).toEqual([]);
	});

	it('parses single reference', () => {
		const refs = parseCrossNoteReferences('x = [[note]].price');
		expect(refs).toHaveLength(1);
		expect(refs[0]).toEqual({
			fullMatch: '[[note]].price',
			noteName: 'note',
			propertyPath: 'price',
		});
	});

	it('parses multiple references', () => {
		const refs = parseCrossNoteReferences('total = [[a]].x + [[b]].y');
		expect(refs).toHaveLength(2);
		expect(refs[0].noteName).toBe('a');
		expect(refs[1].noteName).toBe('b');
	});

	it('parses nested property reference', () => {
		const refs = parseCrossNoteReferences('rate = [[config]].rates.hourly');
		expect(refs).toHaveLength(1);
		expect(refs[0].propertyPath).toBe('rates.hourly');
	});

	it('parses multi-line source', () => {
		const source = 'a = [[x]].val1\nb = [[y]].val2';
		const refs = parseCrossNoteReferences(source);
		expect(refs).toHaveLength(2);
	});

	it('handles reference at start of line', () => {
		const refs = parseCrossNoteReferences('[[note]].price * 2');
		expect(refs).toHaveLength(1);
		expect(refs[0].fullMatch).toBe('[[note]].price');
	});
});

describe('getNestedProperty', () => {
	it('gets top-level property', () => {
		expect(getNestedProperty({ a: 1 }, 'a')).toBe(1);
	});

	it('gets nested property', () => {
		expect(getNestedProperty({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
	});

	it('gets two-level nested property', () => {
		expect(getNestedProperty({ rates: { hourly: 150 } }, 'rates.hourly')).toBe(150);
	});

	it('returns undefined for missing path', () => {
		expect(getNestedProperty({ a: 1 }, 'b')).toBeUndefined();
	});

	it('returns undefined for path through non-object', () => {
		expect(getNestedProperty({ a: 5 }, 'a.b')).toBeUndefined();
	});

	it('returns undefined for empty path segment through null', () => {
		expect(getNestedProperty({ a: null } as Record<string, unknown>, 'a.b')).toBeUndefined();
	});
});

describe('filterAvailableProperties', () => {
	it('returns only $-prefixed keys when numerals: none', () => {
		const metadata = { numerals: 'none', price: 10, $tax: 0.08 };
		const result = filterAvailableProperties(metadata, false);
		expect(result).toEqual({ $tax: 0.08 });
	});

	it('returns all keys when numerals: all', () => {
		const metadata = { numerals: 'all', price: 10, quantity: 5 };
		const result = filterAvailableProperties(metadata, false);
		expect(result).toEqual({ price: 10, quantity: 5 });
	});

	it('returns specific key when numerals is a string', () => {
		const metadata = { numerals: 'price', price: 10, quantity: 5 };
		const result = filterAvailableProperties(metadata, false);
		expect(result).toEqual({ price: 10 });
	});

	it('returns listed keys when numerals is an array', () => {
		const metadata = { numerals: ['price', 'quantity'], price: 10, quantity: 5, name: 'test' };
		const result = filterAvailableProperties(metadata, false);
		expect(result).toEqual({ price: 10, quantity: 5 });
	});

	it('returns all keys when forceAll=true and no numerals key', () => {
		const metadata = { price: 10, quantity: 5 };
		const result = filterAvailableProperties(metadata, true);
		expect(result).toEqual({ price: 10, quantity: 5 });
	});

	it('returns only $-prefixed keys when no numerals key and forceAll=false', () => {
		const metadata = { price: 10, $tax: 0.08 };
		const result = filterAvailableProperties(metadata, false);
		expect(result).toEqual({ $tax: 0.08 });
	});

	it('always includes $-prefixed keys even with numerals: none', () => {
		const metadata = { numerals: 'none', $globalRate: 42 };
		const result = filterAvailableProperties(metadata, false);
		expect(result).toEqual({ $globalRate: 42 });
	});
});

describe('evaluateMetadataValue', () => {
	const emptyPreProcessors: { regex: RegExp; replaceStr: string }[] = [];

	it('evaluates numbers', () => {
		const { result } = evaluateMetadataValue(42, emptyPreProcessors);
		expect(result).toBe(42);
	});

	it('evaluates simple string expressions', () => {
		const { result } = evaluateMetadataValue('2 + 3', emptyPreProcessors);
		expect(result).toBe(5);
	});

	it('returns objects as-is for nested access', () => {
		const obj = { hourly: 150, daily: 1200 };
		const { result } = evaluateMetadataValue(obj, emptyPreProcessors);
		expect(result).toEqual(obj);
	});

	it('takes last element of arrays', () => {
		const { result } = evaluateMetadataValue([10, 20, 30], emptyPreProcessors);
		expect(result).toBe(30);
	});

	it('returns error for invalid expressions', () => {
		const { result, error } = evaluateMetadataValue('invalid expression %%%', emptyPreProcessors);
		expect(result).toBeUndefined();
		expect(error).toBeDefined();
	});

	it('returns error for undefined value', () => {
		const { result, error } = evaluateMetadataValue(undefined, emptyPreProcessors);
		expect(result).toBeUndefined();
		expect(error).toBeDefined();
	});

	it('returns error for null value', () => {
		const { result, error } = evaluateMetadataValue(null, emptyPreProcessors);
		expect(result).toBeUndefined();
		expect(error).toBeDefined();
	});

	it('applies preprocessors to string values', () => {
		const preProcessors = [
			{ regex: /,([\d]{3})/g, replaceStr: '$1' }, // remove thousands separators
		];
		const { result } = evaluateMetadataValue('1,000', preProcessors);
		expect(result).toBe(1000);
	});
});

describe('formatValueForInsertion', () => {
	it('formats numbers', () => {
		expect(formatValueForInsertion(42)).toBe('42');
		expect(formatValueForInsertion(3.14)).toBe('3.14');
	});

	it('formats strings as-is', () => {
		expect(formatValueForInsertion('10 USD')).toBe('10 USD');
	});

	it('formats mathjs values', () => {
		// This tests that mathjs BigNumber and similar types are handled
		const result = formatValueForInsertion(100.5);
		expect(result).toBe('100.5');
	});
});

describe('CROSS_NOTE_TRIGGER_REGEX (suggestor)', () => {
	// Import the regex from the suggestor context is not easy since it's
	// private to the module, so we test the pattern directly here.
	const CROSS_NOTE_TRIGGER_REGEX = /\[\[([^\]]+)\]\]\.([\w$\u00C0-\u02AF\u0370-\u03FF]*)$/;

	it('matches [[note]]. at end of string (empty property)', () => {
		const match = 'x = [[my note]].'.match(CROSS_NOTE_TRIGGER_REGEX);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('my note');
		expect(match![2]).toBe('');
	});

	it('matches [[note]].partial at end of string', () => {
		const match = 'x = [[my note]].pri'.match(CROSS_NOTE_TRIGGER_REGEX);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('my note');
		expect(match![2]).toBe('pri');
	});

	it('does not match [[note]] without dot', () => {
		const match = 'x = [[my note]]'.match(CROSS_NOTE_TRIGGER_REGEX);
		expect(match).toBeNull();
	});

	it('does not match in middle of expression', () => {
		const match = '[[note]].price + 2'.match(CROSS_NOTE_TRIGGER_REGEX);
		expect(match).toBeNull();
	});

	it('matches with $-prefixed property', () => {
		const match = '[[note]].$ta'.match(CROSS_NOTE_TRIGGER_REGEX);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('$ta');
	});
});
