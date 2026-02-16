import * as math from "mathjs";
import { CurrencyType } from "./numerals.types";

type ParseIsAlpha = typeof math.parse.isAlpha;
type UnitIsValidAlpha = (c: string) => boolean;

let originalParseIsAlpha: ParseIsAlpha | null = null;
let originalUnitIsValidAlpha: UnitIsValidAlpha | null = null;

function ensureOriginalsCached(): void {
	if (!originalParseIsAlpha) {
		originalParseIsAlpha = math.parse.isAlpha;
	}
	if (!originalUnitIsValidAlpha) {
		originalUnitIsValidAlpha = math.Unit.isValidAlpha as UnitIsValidAlpha;
	}
}

function isDuplicateUnitError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/(already exists|already defined|Duplicate unit|exists)/i.test(error.message)
	);
}

/**
 * Patch mathjs symbol parsing to treat configured currency symbols as alpha characters.
 * This is reversible via `teardownMathjsCurrencySupport`.
 */
export function setupMathjsCurrencySupport(currencySymbols: string[]): void {
	ensureOriginalsCached();
	const symbolSet = new Set(currencySymbols);

	math.parse.isAlpha = (c, cPrev, cNext) => {
		return Boolean(originalParseIsAlpha?.(c, cPrev, cNext) || symbolSet.has(c));
	};

	math.Unit.isValidAlpha = (c: string) => {
		return Boolean(originalUnitIsValidAlpha?.(c) || symbolSet.has(c));
	};
}

/**
 * Restore original mathjs parser behavior.
 */
export function teardownMathjsCurrencySupport(): void {
	if (originalParseIsAlpha) {
		math.parse.isAlpha = originalParseIsAlpha;
	}
	if (originalUnitIsValidAlpha) {
		math.Unit.isValidAlpha = originalUnitIsValidAlpha;
	}
}

/**
 * Ensure currency units exist without crashing on plugin reloads.
 */
export function ensureCurrencyUnits(currencyMap: CurrencyType[]): void {
	for (const moneyType of currencyMap) {
		if (!moneyType.currency) {
			continue;
		}

		try {
			math.createUnit(moneyType.currency, {
				aliases: [moneyType.currency.toLowerCase(), moneyType.symbol],
			});
		} catch (error) {
			// Obsidian plugin reloads can hit duplicate definitions; ignore those only.
			if (!isDuplicateUnitError(error)) {
				throw error;
			}
		}
	}
}
