/**
 * Shared helpers for constructing a NumeralsDisplayContext in tests.
 *
 * Not a test file (no `.test.ts` suffix), so jest imports it without running it.
 */

import {
	CurrencyResultDisplay,
	NumeralsDisplayContext,
	mathjsFormat,
} from '../src/numerals.types';
import { defaultCurrencyMap } from '../src/rendering/displayUtils';

/**
 * Build a NumeralsDisplayContext for tests.
 *
 * Defaults mirror the plugin defaults: no explicit number format, the default
 * currency map, and symbol currency display.
 *
 * @param overrides - Partial fields to override (numberFormat, currencyDisplay, etc.)
 */
export function makeDisplayContext(
	overrides: Partial<NumeralsDisplayContext> = {}
): NumeralsDisplayContext {
	return {
		numberFormat: undefined,
		currencies: defaultCurrencyMap,
		currencyDisplay: CurrencyResultDisplay.Symbol,
		...overrides,
	};
}

/** Convenience: a display context using the given number format (symbol display). */
export function displayContextWithFormat(numberFormat: mathjsFormat): NumeralsDisplayContext {
	return makeDisplayContext({ numberFormat });
}
