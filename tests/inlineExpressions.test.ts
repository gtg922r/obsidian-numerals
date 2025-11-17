import { processInlineMathExpressions } from '../src/numeralsUtilities';
import { NumeralsScope, StringReplaceMap } from '../src/numerals.types';
import { MarkdownPostProcessorContext, App } from 'obsidian';
import * as math from 'mathjs';

// Create currency units for testing
const currencyTypes = [
	{ symbol: '$', currency: 'USD' },
	{ symbol: '¥', currency: 'JPY' },
	{ symbol: '£', currency: 'GBP' },
	{ symbol: '€', currency: 'EUR' },
];

for (const moneyType of currencyTypes) {
	if (moneyType.currency != '') {
		math.createUnit(moneyType.currency, {aliases:[moneyType.currency.toLowerCase(), moneyType.symbol]});
	}
}

// Mock the MarkdownPostProcessorContext
const createMockContext = (sourcePath: string): MarkdownPostProcessorContext => {
	return {
		sourcePath,
		frontmatter: {},
		addChild: jest.fn(),
		getSectionInfo: jest.fn(),
	} as unknown as MarkdownPostProcessorContext;
};

// Mock App instance - only needs the minimal interface for getMetadataForFileAtPath
const createMockApp = (): App => {
	return {
		vault: {
			getAbstractFileByPath: jest.fn(() => undefined)
		},
		metadataCache: {
			getFileCache: jest.fn(() => undefined)
		}
	} as unknown as App;
};

describe('Inline Math Expressions', () => {
	let scopeCache: Map<string, NumeralsScope>;
	let numberFormat: any;
	let preProcessors: StringReplaceMap[];

	beforeEach(() => {
		scopeCache = new Map<string, NumeralsScope>();
		numberFormat = { notation: 'fixed' };
		preProcessors = [
			{ regex: /,(\d{3})/g, replaceStr: '$1' }, // remove thousands separators
			{ regex: /\$([0-9.]+)/g, replaceStr: '$1 USD' }, // currency preprocessing
		];
	});

	describe('Basic Expression Evaluation', () => {
		test('should evaluate simple arithmetic expression', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: 3*4';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('12');
		});

		test('should evaluate expression with units', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: 5 m + 3 m';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toContain('8');
			expect(resultSpan?.textContent).toContain('m');
		});

		test('should evaluate expression with mathjs functions', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: sqrt(16)';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('4');
		});
	});

	describe('Variable References', () => {
		test('should reference page-global variable from scope cache', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: $length';
			container.appendChild(code);

			const ctx = createMockContext('test.md');
			const scope = new NumeralsScope();
			scope.set('$length', 10);
			scopeCache.set('test.md', scope);

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('10');
		});

		test('should use variable in calculation', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: $length * 2';
			container.appendChild(code);

			const ctx = createMockContext('test.md');
			const scope = new NumeralsScope();
			scope.set('$length', 5);
			scopeCache.set('test.md', scope);

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('10');
		});

		test('should use multiple variables in calculation', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: $length * $width';
			container.appendChild(code);

			const ctx = createMockContext('test.md');
			const scope = new NumeralsScope();
			scope.set('$length', 10);
			scope.set('$width', 5);
			scopeCache.set('test.md', scope);

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('50');
		});
	});

	describe('Error Handling', () => {
		test('should display error for undefined variable', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: undefinedVar';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const errorSpan = container.querySelector('.numerals-inline-error');
			expect(errorSpan).not.toBeNull();
			expect(errorSpan?.textContent).toContain('Error');
		});

		test('should display error for invalid expression', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: 5 + *';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const errorSpan = container.querySelector('.numerals-inline-error');
			expect(errorSpan).not.toBeNull();
			expect(errorSpan?.textContent).toContain('Error');
		});

		test('should handle division by zero gracefully', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: 1/0';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			// mathjs returns Infinity for division by zero
			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('Infinity');
		});
	});

	describe('Multiple Inline Expressions', () => {
		test('should process multiple inline expressions in same container', () => {
			const container = document.createElement('div');
			
			const code1 = document.createElement('code');
			code1.textContent = 'mathexpr: 3+4';
			container.appendChild(code1);
			
			const text = document.createTextNode(' and ');
			container.appendChild(text);
			
			const code2 = document.createElement('code');
			code2.textContent = 'mathexpr: 5*6';
			container.appendChild(code2);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const results = container.querySelectorAll('.numerals-inline-result');
			expect(results.length).toBe(2);
			expect(results[0].textContent).toBe('7');
			expect(results[1].textContent).toBe('30');
		});

		test('should not affect non-mathexpr inline code', () => {
			const container = document.createElement('div');
			
			const code1 = document.createElement('code');
			code1.textContent = 'regular code';
			container.appendChild(code1);
			
			const code2 = document.createElement('code');
			code2.textContent = 'mathexpr: 2+2';
			container.appendChild(code2);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			// First code should remain unchanged
			const regularCode = container.querySelector('code');
			expect(regularCode).not.toBeNull();
			expect(regularCode?.textContent).toBe('regular code');

			// Second should be processed
			const result = container.querySelector('.numerals-inline-result');
			expect(result).not.toBeNull();
			expect(result?.textContent).toBe('4');
		});
	});

	describe('Preprocessing', () => {
		test('should apply preprocessors to expression', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: 1,000 + 500';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('1500');
		});

		test('should handle currency symbols', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: $100 + $50';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toContain('150');
			expect(resultSpan?.textContent).toContain('USD');
		});
	});

	describe('Whitespace Handling', () => {
		test('should handle expression with leading/trailing whitespace', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr:   3 + 4   ';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('7');
		});

		test('should handle no space after colon', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr:2+2';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('4');
		});
	});

	describe('Scope Isolation', () => {
		test('should use scope from correct file', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: $value';
			container.appendChild(code);

			const ctx = createMockContext('file1.md');
			
			const scope1 = new NumeralsScope();
			scope1.set('$value', 100);
			scopeCache.set('file1.md', scope1);
			
			const scope2 = new NumeralsScope();
			scope2.set('$value', 200);
			scopeCache.set('file2.md', scope2);

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('100');
		});

		test('should work without scope cache entry', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: 2*3';
			container.appendChild(code);

			const ctx = createMockContext('new-file.md');
			// No scope entry for 'new-file.md'

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('6');
		});
	});

	describe('Complex Expressions', () => {
		test('should evaluate complex mathematical expression', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: (5 + 3) * 2 - 4 / 2';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('14');
		});

		test('should evaluate expression with nested functions', () => {
			const container = document.createElement('div');
			const code = document.createElement('code');
			code.textContent = 'mathexpr: sqrt(pow(3, 2) + pow(4, 2))';
			container.appendChild(code);

			const ctx = createMockContext('test.md');

			processInlineMathExpressions(container, ctx, scopeCache, numberFormat, preProcessors, createMockApp());

			const resultSpan = container.querySelector('.numerals-inline-result');
			expect(resultSpan).not.toBeNull();
			expect(resultSpan?.textContent).toBe('5');
		});
	});
});
