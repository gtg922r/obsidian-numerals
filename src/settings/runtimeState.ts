import equal from 'fast-deep-equal';
import type { MathJsInstance } from 'mathjs';
import type { CurrencyType, NumeralsSettings, StringReplaceMap } from '../numerals.types';
import { createNumberFormatProfile, createResultFormatter, CurrencyRegistry, ResultFormatter } from '../formatting';
import { activateMathRuntime, createUnavailableMathRuntime, getMathRuntime, resetMathRuntime } from '../mathRuntime';
import { createCurrencyRuntime, currencyMappings, CurrencyRuntime } from './currencyRuntime';
import type { SettingsRuntime } from './changes';

/** Retain this context with each evaluation generation; never mix engines' Units. */
export interface NumeralsRuntimeContext {
	readonly engine: MathJsInstance;
	readonly configurationError?: string;
	readonly currencyWarnings: readonly string[];
	readonly currencyGeneration: number;
	readonly currencyMap: readonly CurrencyType[];
	readonly preProcessors: StringReplaceMap[];
	readonly formatter: ResultFormatter;
}

/** Builds complete candidate contexts without changing the currently active context. */
export class NumeralsSettingsRuntime implements SettingsRuntime {
	private activeCurrency?: CurrencyRuntime;
	private activeContext?: NumeralsRuntimeContext;
	// Ephemeron ownership keeps cleanup available while any formatter retains its engine.
	private currencyOwners = new WeakMap<MathJsInstance, CurrencyRuntime>();
	private retainedCurrencies = new Set<WeakRef<CurrencyRuntime>>();
	private disposed = false;

	constructor(private readonly makeProcessors: (mappings: readonly CurrencyType[]) => StringReplaceMap[]) {}

	get context(): NumeralsRuntimeContext {
		if (!this.activeContext) throw new Error('Numerals runtime is not loaded.');
		return this.activeContext;
	}

	get configurationError(): string | undefined { return this.activeContext?.configurationError; }

	block(settings: NumeralsSettings, error: unknown): void {
		const message = error instanceof Error ? error.message : 'Invalid currency mapping.';
		const configurationError = message.includes('Numerals settings') ? message :
			`${message} Open Numerals settings to edit or remove the mapping.`;
		const engine = createUnavailableMathRuntime(configurationError);
		this.activeContext = { engine, configurationError, currencyWarnings: [], currencyGeneration: 0,
			currencyMap: [], preProcessors: [], formatter: createResultFormatter({ runtime: engine,
				profile: createNumberFormatProfile(settings.numberFormat, undefined, engine) }) };
		activateMathRuntime(engine);
	}

	prepare(settings: NumeralsSettings): { activate(): void; dispose(): void } {
		if (this.disposed) throw new Error('Numerals runtime is unloaded.');
		const previous = this.activeCurrency;
		const mappingChanged = !previous || !equal(previous.mappings, currencyMappings(settings));
		const currency = mappingChanged ? createCurrencyRuntime(settings, previous) : previous;
		let context: NumeralsRuntimeContext;
		try {
			const preProcessors = this.makeProcessors(currency.mappings);
			const customCode = settings.customCurrencySymbol?.currency;
			const registry = CurrencyRegistry.create(currency.mappings, {
				runtime: currency.math,
				fractionDigitsByCode: customCode ? new Map([[customCode, settings.customCurrencyDecimalPlaces]]) : undefined,
			});
			context = {
				engine: currency.math, currencyWarnings: currency.warnings,
				currencyGeneration: (this.activeContext?.currencyGeneration ?? 0) + Number(mappingChanged),
				currencyMap: currency.mappings,
				preProcessors,
				formatter: createResultFormatter({ runtime: currency.math, currencies: registry,
					profile: createNumberFormatProfile(settings.numberFormat, undefined, currency.math), preProcessors,
					currencyPrecisionMode: settings.currencyPrecisionMode, currencyDisplayMode: settings.currencyDisplayMode }),
			};
		} catch (error) {
			if (mappingChanged) currency.dispose();
			throw error;
		}
		return {
			activate: () => {
				this.activeCurrency = currency;
				this.activeContext = context;
				if (mappingChanged) {
					for (const reference of this.retainedCurrencies) if (!reference.deref()) this.retainedCurrencies.delete(reference);
					this.currencyOwners.set(currency.math, currency);
					this.retainedCurrencies.add(new WeakRef(currency));
				}
				activateMathRuntime(currency.math);
			},
			dispose: () => { if (mappingChanged) currency.dispose(); },
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.activeContext?.engine === getMathRuntime()) resetMathRuntime();
		for (const reference of this.retainedCurrencies) reference.deref()?.dispose();
		this.currencyOwners = new WeakMap();
		this.retainedCurrencies.clear();
		this.activeCurrency = undefined;
		this.activeContext = undefined;
	}
}
