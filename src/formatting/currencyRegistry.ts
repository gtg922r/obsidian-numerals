import type { MathJsInstance, Unit } from 'mathjs';
import { getMathRuntime } from '../mathRuntime';
import { normalizeCurrencyAliases } from '../settings/currencyAliases';
import type { CurrencyType } from '../numerals.types';
import type {
	CurrencyDefinition,
	CurrencyMatch,
} from './types';

const DEFAULT_CURRENCY_FRACTION_DIGITS = 2;
const MIN_CURRENCY_FRACTION_DIGITS = 0;
const MAX_CURRENCY_FRACTION_DIGITS = 20;

export interface CurrencyRegistryOptions {
	locale?: string;
	runtime?: MathJsInstance;
	fractionDigitsByCode?: ReadonlyMap<string, number>;
}

/**
 * Immutable view of the currency units active in Numerals.
 *
 * Unit creation remains a plugin lifecycle concern. The registry only captures
 * already-created units and classifies evaluated values through public mathjs
 * Unit APIs.
 */
export class CurrencyRegistry {
	private readonly definitionsByCode: ReadonlyMap<string, CurrencyDefinition>;
	readonly definitions: readonly CurrencyDefinition[];

	private constructor(definitions: CurrencyDefinition[], readonly runtime: MathJsInstance,
		readonly mappings: readonly CurrencyType[]) {
		this.definitions = Object.freeze(definitions.map(definition => Object.freeze(definition)));
		this.definitionsByCode = new Map(
			this.definitions.map(definition => [definition.code, definition])
		);
	}

	static create(
		currencyMap: readonly CurrencyType[],
		options: CurrencyRegistryOptions = {}
	): CurrencyRegistry {
		const math = options.runtime ?? getMathRuntime();
		const clonedEntries = currencyMap.map(entry => ({ ...entry }));
		const definitionsByCode = new Map<string, CurrencyDefinition>();

		for (const entry of clonedEntries) {
			const code = entry.currency.trim();
			if (code.length === 0) {
				continue;
			}

			let unit: Unit;
			try {
				unit = math.unit(code);
			} catch {
				// A malformed or not-yet-created custom unit is not active.
				continue;
			}

			const configuredDigits = options.fractionDigitsByCode?.get(code);
			const fractionDigits = isValidFractionDigits(configuredDigits)
				? configuredDigits
				: undefined;
			const resolvedFractionDigits = fractionDigits ??
				getCurrencyFractionDigits(code, options.locale);

			definitionsByCode.set(code, {
				code,
				symbol: entry.symbol,
				texCommand: Array.from(entry.symbol).map(character => `\\unicode{x${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}}`).join(''),
				fractionDigits: resolvedFractionDigits,
				unit,
			});
		}

		return new CurrencyRegistry([...definitionsByCode.values()], math, Object.freeze(clonedEntries.map(entry => Object.freeze(entry))));
	}

	get(code: string): CurrencyDefinition | undefined {
		return this.definitionsByCode.get(code);
	}

	/** Code-only unit notation on a detached value, including native compound aliases. */
	canonicalizeAliases(value: unknown): unknown {
		return normalizeCurrencyAliases(value, this.mappings, this.runtime);
	}

	/** Match a dimensionally pure currency result from the active registry. */
	match(value: unknown): CurrencyMatch | undefined {
		if (!this.runtime.isUnit(value)) {
			return undefined;
		}

		for (const definition of this.definitions) {
			if (!value.equalBase(definition.unit)) {
				continue;
			}

			try {
				return {
					definition,
					amount: value.toNumber(definition.code),
				};
			} catch {
				// A matching base should convert, but a bad custom definition must
				// not make result formatting fail for unrelated output.
				return undefined;
			}
		}

		return undefined;
	}
}

function isValidFractionDigits(value: number | undefined): value is number {
	return value !== undefined &&
		Number.isInteger(value) &&
		value >= MIN_CURRENCY_FRACTION_DIGITS &&
		value <= MAX_CURRENCY_FRACTION_DIGITS;
}

function getCurrencyFractionDigits(code: string, locale?: string): number {
	if (!/^[A-Za-z]{3}$/u.test(code)) {
		return DEFAULT_CURRENCY_FRACTION_DIGITS;
	}

	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: code.toUpperCase(),
		}).resolvedOptions().maximumFractionDigits ??
			DEFAULT_CURRENCY_FRACTION_DIGITS;
	} catch {
		return DEFAULT_CURRENCY_FRACTION_DIGITS;
	}
}
