import type { NumeralsSettings } from '../numerals.types';
import { applySettingsPatch, normalizeSettings, settingsEqual } from './normalization';

export type SettingsEffect = 'evaluation' | 'presentation' | 'suggestions';
const effects: Record<keyof NumeralsSettings, SettingsEffect> = {
	resultSeparator: 'presentation', layoutStyle: 'presentation', alternateRowColor: 'presentation',
	defaultRenderStyle: 'presentation', hideLinesWithoutMarkupWhenEmitting: 'presentation',
	hideEmitterMarkupInInput: 'presentation', numberFormat: 'presentation',
	currencyPrecisionMode: 'presentation', currencyDisplayMode: 'presentation',
	customCurrencyDecimalPlaces: 'presentation', inlineEquationSeparator: 'presentation',
	dollarSymbolCurrency: 'evaluation', yenSymbolCurrency: 'evaluation', customCurrencySymbol: 'evaluation',
	forceProcessAllFrontmatter: 'evaluation', enableCrossNoteReferences: 'evaluation',
	enableInlineNumerals: 'evaluation', inlineResultTrigger: 'evaluation', inlineEquationTrigger: 'evaluation',
	inlineTexResultTrigger: 'evaluation', inlineTexEquationTrigger: 'evaluation',
	provideSuggestions: 'suggestions', suggestionsIncludeMathjsSymbols: 'suggestions',
	enableGreekAutoComplete: 'suggestions', provideInlineSuggestions: 'suggestions',
};

export interface SettingsChange {
	readonly generation: number;
	readonly evaluationGeneration: number;
	readonly keys: readonly (keyof NumeralsSettings)[];
	readonly effects: ReadonlySet<SettingsEffect>;
	readonly settings: Readonly<NumeralsSettings>;
	readonly configurationError?: string;
}

export interface SettingsRuntime {
	readonly configurationError?: string;
	block?(settings: NumeralsSettings, error: unknown): void;
	/** Prepare without touching active state; activation only swaps validated references. */
	prepare(settings: NumeralsSettings): { activate(): void; dispose(): void };
	dispose(): void;
}

/** Serialized persistence with a coherent runtime/settings boundary for F/G subscribers. */
export class SettingsController {
	private value: NumeralsSettings;
	private queue: Promise<void> = Promise.resolve();
	private listeners = new Set<(change: SettingsChange) => void>();
	private generation = 0;
	private evaluationGeneration = 0;
	private disposed = false;

	constructor(data: unknown, private readonly runtime: SettingsRuntime,
		private readonly persist: (settings: NumeralsSettings) => Promise<void>) {
		this.value = normalizeSettings(data);
		try { this.runtime.prepare(this.value).activate(); } catch (error) {
			if (!this.runtime.block) throw error;
			this.runtime.block(this.value, error);
		}
	}

	get settingsGeneration(): number { return this.generation; }
	get evaluationSettingsGeneration(): number { return this.evaluationGeneration; }

	get settings(): NumeralsSettings { return normalizeSettings(this.value); }

	subscribe(listener: (change: SettingsChange) => void): () => void {
		if (this.disposed) throw new Error('Numerals settings are unloaded.');
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	update(patch: Record<string, unknown>): Promise<void> {
		// Capture input now; callers cannot mutate queued nested settings.
		const captured = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key,
			value !== null && typeof value === 'object' ? (Array.isArray(value) ? [...(value as unknown[])] : { ...value }) : value]));
		const operation = this.queue.then(async () => {
			if (this.disposed) throw new Error('Numerals settings are unloaded.');
			const previous = this.value;
			const next = applySettingsPatch(previous, captured);
			if (settingsEqual(previous, next)) return;
			const prepared = this.runtime.prepare(next);
			try {
				await this.persist(normalizeSettings(next));
			} catch (error) {
				prepared.dispose();
				throw error;
			}
			if (this.disposed) { prepared.dispose(); return; }
			prepared.activate();
			this.publish(next);
		});
		this.queue = operation.catch(() => { /* Keep subsequent edits usable after a reported failure. */ });
		return operation;
	}

	private publish(next: NumeralsSettings): void {
		const keys = (Object.keys(effects) as (keyof NumeralsSettings)[])
			.filter(key => !settingsEqualValue(this.value[key], next[key]));
		const changedEffects = new Set(keys.map(key => effects[key]));
		this.value = next;
		this.generation++;
		if (changedEffects.has('evaluation')) this.evaluationGeneration++;
		for (const listener of this.listeners) {
			try {
				listener({ generation: this.generation, evaluationGeneration: this.evaluationGeneration,
					keys, effects: new Set(changedEffects), settings: this.settings, configurationError: this.runtime.configurationError });
			} catch (error) {
				console.error('Numerals settings subscriber failed', error);
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
		this.runtime.dispose();
	}
}

function settingsEqualValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
