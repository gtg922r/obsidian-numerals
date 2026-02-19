/**
 * Unit tests for inline Numerals suggestor context detection.
 */

jest.mock('obsidian', () => ({}), { virtual: true });
jest.mock(
	'obsidian-dataview',
	() => ({ getAPI: () => () => {} }),
	{ virtual: true },
);

import { findInlineNumeralsContext } from '../src/inlineSuggestorUtils';

const RESULT_TRIGGER = '#:';
const EQUATION_TRIGGER = '#=:';

function find(line: string, cursorCh: number, resultTrigger = RESULT_TRIGGER, equationTrigger = EQUATION_TRIGGER) {
	return findInlineNumeralsContext(line, cursorCh, resultTrigger, equationTrigger);
}

describe('findInlineNumeralsContext', () => {

	// --- Basic detection ---
	describe('basic detection', () => {
		it('should detect cursor inside result-only inline code', () => {
			// t(0)e(1)x(2)t(3) (4)`(5)#(6):(7) (8)3(9)+(10)2(11)`(12) (13)m(14)
			const line = 'text `#: 3+2` more';
			const result = find(line, 11); // cursor at '2'
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('#:');
		});

		it('should detect cursor inside equation inline code', () => {
			// t(0)e(1)x(2)t(3) (4)`(5)#(6)=(7):(8) (9)3(10)+(11)2(12)`(13) (14)m(15)
			const line = 'text `#=: 3+2` more';
			const result = find(line, 12); // cursor at '2'
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('#=:');
		});

		it('should return null when cursor is outside inline code', () => {
			const line = 'text `#: 3+2` more';
			const result = find(line, 16); // cursor in 'more'
			expect(result).toBeNull();
		});

		it('should return null for non-Numerals inline code', () => {
			const line = 'text `console.log()` more';
			const result = find(line, 15);
			expect(result).toBeNull();
		});
	});

	// --- Expression text extraction ---
	describe('expression text extraction', () => {
		it('should extract expression text after trigger', () => {
			// `(0)#(1):(2) (3)p(4)r(5)i(6)c(7)e(8) (9)*(10) (11)q(12)t(13)y(14)`(15)
			const line = '`#: price * qty`';
			const result = find(line, 15); // cursor after 'y', before closing backtick
			expect(result).not.toBeNull();
			expect(result!.expressionUpToCursor).toBe(' price * qty');
		});

		it('should handle cursor right after trigger prefix', () => {
			// `(0)#(1):(2) (3)`(4)
			const line = '`#: `';
			const result = find(line, 4); // cursor after space, before closing backtick
			expect(result).not.toBeNull();
			expect(result!.expressionUpToCursor).toBe(' ');
		});

		it('should return expression text up to cursor, not full expression', () => {
			const line = '`#: price * qty`';
			const result = find(line, 10); // cursor at ' ' before *
			expect(result).not.toBeNull();
			expect(result!.expressionUpToCursor).toBe(' price ');
		});
	});

	// --- Column tracking ---
	describe('column tracking', () => {
		it('should return the column of expression start (after trigger)', () => {
			// t(0)e(1)x(2)t(3) (4)`(5)#(6):(7) (8)s(9)q(10)r(11)t(12)`(13)
			const line = 'text `#: sqrt`';
			const result = find(line, 12); // cursor at 't' in sqrt
			expect(result).not.toBeNull();
			// backtick at 5, trigger '#:' is 2 chars => expression starts at col 8
			expect(result!.expressionStartCh).toBe(8);
		});

		it('should return correct column for equation trigger', () => {
			// `(0)#(1)=(2):(3) (4)x(5)`(6)
			const line = '`#=: x`';
			const result = find(line, 5); // cursor at 'x'
			expect(result).not.toBeNull();
			// backtick at 0, trigger '#=:' is 3 chars => expression starts at col 4
			expect(result!.expressionStartCh).toBe(4);
		});
	});

	// --- Multiple inline code spans ---
	describe('multiple inline code spans', () => {
		it('should detect the correct span when multiple exist', () => {
			const line = '`code` and `#: x + y` and `more`';
			const result = find(line, 17); // cursor inside '#: x + y'
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('#:');
		});

		it('should return null when cursor is in a non-Numerals span among multiple', () => {
			const line = '`code` and `#: x + y` and `more`';
			const result = find(line, 3); // cursor inside 'code'
			expect(result).toBeNull();
		});

		it('should detect second Numerals span', () => {
			const line = '`#: a` and `#=: b`';
			const result = find(line, 16); // cursor in second span at 'b'
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('#=:');
		});
	});

	// --- Edge cases ---
	describe('edge cases', () => {
		it('should return null when no closing backtick', () => {
			const line = 'text `#: 3+2';
			const result = find(line, 10);
			expect(result).toBeNull();
		});

		it('should return null for empty line', () => {
			expect(find('', 0)).toBeNull();
		});

		it('should handle cursor at opening backtick', () => {
			const line = '`#: x`';
			// cursor at position 0 (the backtick itself) — not inside the code
			expect(find(line, 0)).toBeNull();
		});

		it('should detect cursor right before closing backtick', () => {
			// `(0)#(1):(2) (3)x(4)`(5)
			// cursorCh=5 means cursor is between x and ` — still inside
			const line = '`#: x`';
			const result = find(line, 5);
			expect(result).not.toBeNull();
			expect(result!.expressionUpToCursor).toBe(' x');
		});

		it('should return null for cursor after closing backtick', () => {
			const line = '`#: x` more';
			expect(find(line, 6)).toBeNull();
		});

		it('should work when inline code is at start of line', () => {
			const line = '`#: pi`';
			const result = find(line, 5); // cursor at 'i' in pi
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('#:');
		});

		it('should work when inline code is at end of line', () => {
			const line = 'result: `#: 42`';
			const result = find(line, 13); // cursor at '2'
			expect(result).not.toBeNull();
		});
	});

	// --- Custom triggers ---
	describe('custom triggers', () => {
		it('should work with custom trigger prefixes', () => {
			const line = '`nm: sqrt(2)`';
			const result = find(line, 10, 'nm:', 'nm=:');
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('nm:');
		});

		it('should handle empty result trigger gracefully', () => {
			const line = '`#=: x`';
			const result = find(line, 5, '', '#=:');
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('#=:');
		});

		it('should return null when both triggers are empty', () => {
			const line = '`anything`';
			expect(find(line, 5, '', '')).toBeNull();
		});
	});

	// --- Trigger precedence ---
	describe('trigger precedence', () => {
		it('should match longer trigger first when one is prefix of another', () => {
			const line = '`#=: 5*3`';
			const result = find(line, 7);
			expect(result).not.toBeNull();
			expect(result!.triggerPrefix).toBe('#=:');
		});
	});
});
