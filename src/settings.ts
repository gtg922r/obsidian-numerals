import { App, Plugin, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import {
	CurrencyDisplayMode, CurrencyPrecisionMode, MAX_CURRENCY_DECIMAL_PLACES, MIN_CURRENCY_DECIMAL_PLACES,
	NumeralsLayout, NumeralsNumberFormat, NumeralsRenderStyle, NumeralsSettings,
} from './numerals.types';
import { CurrencyMappingModal } from './settings/currencyModal';
import { inlineTriggerKeys, settingError } from './settings/normalization';
export { currencyCodesForDollarSign, currencyCodesForYenSign } from './settings/currencies';

export const NumberalsNumberFormatSettingsStrings = {
	[NumeralsNumberFormat.System]: `System format: ${(100000.1).toLocaleString()}`,
	[NumeralsNumberFormat.Fixed]: 'Fixed: 100000.1',
	[NumeralsNumberFormat.Exponential]: 'Exponential: 1.000001e+5',
	[NumeralsNumberFormat.Engineering]: 'Engineering: 100.0001e+3',
	[NumeralsNumberFormat.Format_CommaThousands_PeriodDecimal]: 'Formatted: 100,000.1',
	[NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal]: 'Formatted: 100.000,1',
	[NumeralsNumberFormat.Format_SpaceThousands_CommaDecimal]: 'Formatted: 100 000,1',
	[NumeralsNumberFormat.Format_Indian]: 'Formatted: 1,00,000.1',
};

export interface NumeralsSettingsHost extends Plugin {
	settings: NumeralsSettings;
	readonly configurationError?: string;
	readonly currencyWarnings?: readonly string[];
	updateSettings(patch: Record<string, unknown>): Promise<void>;
}

/** Obsidian 1.13 definitions are also the global settings search index. */
export class NumeralsSettingTab extends PluginSettingTab {
	icon = 'calculator';
	constructor(app: App, readonly plugin: NumeralsSettingsHost) { super(app, plugin); }

	getControlValue(key: string): unknown { return this.plugin.settings[key as keyof NumeralsSettings]; }

	async setControlValue(key: string, value: unknown): Promise<void> {
		// Overriding this hook replaces Obsidian's default mutation AND saveData.
		await this.plugin.updateSettings({ [key]: value });
		this.refreshDomState();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const triggerNames = ['Result-only trigger', 'Equation trigger', 'TeX result trigger', 'TeX equation trigger'];
		return [
			...(this.plugin.configurationError ? [{ name: 'Currency configuration needs attention', desc: this.plugin.configurationError }] : []),
			...(this.plugin.currencyWarnings ?? []).map(desc => ({ name: 'Currency alias', desc })),
			{ name: 'Layout', desc: 'Choose the arrangement of expressions and results.', control: {
				type: 'dropdown', key: 'layoutStyle', options: {
					[NumeralsLayout.TwoPanes]: 'Two panes', [NumeralsLayout.AnswerRight]: 'Answer to the right',
					[NumeralsLayout.AnswerBelow]: 'Answer below each line', [NumeralsLayout.AnswerInline]: 'Answer beside input',
				},
			} },
			{ name: 'Default rendering style', desc: 'Choose how math blocks render by default.', control: {
				type: 'dropdown', key: 'defaultRenderStyle', options: {
					[NumeralsRenderStyle.Plain]: 'Plain text', [NumeralsRenderStyle.TeX]: 'TeX',
					[NumeralsRenderStyle.SyntaxHighlight]: 'Syntax highlighting',
				},
			} },
			{ type: 'group', heading: 'Appearance', items: [
				{ name: 'Result indicator', desc: 'Show this text before a calculation result.', control: { type: 'text', key: 'resultSeparator' } },
				{ name: 'Alternating row color', desc: 'Use alternating colors to distinguish rows.', control: { type: 'toggle', key: 'alternateRowColor' } },
				{ name: 'Hide unannotated results', desc: 'Hide other results when a block uses result annotations.', control: { type: 'toggle', key: 'hideLinesWithoutMarkupWhenEmitting' } },
				{ name: 'Hide result annotation markup', desc: 'Hide the => marker in rendered input.', control: { type: 'toggle', key: 'hideEmitterMarkupInInput' } },
			] },
			{ type: 'group', heading: 'Number and currency formatting', items: [
				{ name: 'Rendered number format', desc: 'Choose the notation used for displayed numbers.', control: { type: 'dropdown', key: 'numberFormat', options: NumberalsNumberFormatSettingsStrings } },
				{ name: 'Currency precision', desc: 'Choose the decimal-place policy for pure currency results.', control: {
					type: 'dropdown', key: 'currencyPrecisionMode', options: {
						[CurrencyPrecisionMode.CurrencyStandard]: 'Use currency standard',
						[CurrencyPrecisionMode.FollowNumberFormat]: 'Use rendered number format',
					},
				} },
				{ name: 'Currency display', desc: 'Choose codes or symbols for pure currency results.', control: {
					type: 'dropdown', key: 'currencyDisplayMode', options: {
						[CurrencyDisplayMode.Code]: 'Currency code', [CurrencyDisplayMode.Symbol]: 'Configured symbol',
					},
				} },
				{ name: 'Custom currency decimal places', desc: 'Set standard precision for the custom currency.', control: {
					type: 'number', key: 'customCurrencyDecimalPlaces', min: MIN_CURRENCY_DECIMAL_PLACES, max: MAX_CURRENCY_DECIMAL_PLACES, step: 1,
					validate: value => settingError(this.plugin.settings, 'customCurrencyDecimalPlaces', value),
					disabled: () => this.plugin.settings.currencyPrecisionMode !== CurrencyPrecisionMode.CurrencyStandard,
				} },
				...(['dollarSymbolCurrency', 'yenSymbolCurrency', 'customCurrencySymbol'] as const).map(key => ({
					name: key === 'customCurrencySymbol' ? 'Custom currency mapping' : `${key === 'dollarSymbolCurrency' ? '$' : '¥'} currency mapping`,
					desc: this.plugin.settings[key] ? `${this.plugin.settings[key].symbol} → ${this.plugin.settings[key].currency}` : 'Add a custom symbol and currency code.',
					aliases: [key, 'Currency symbol'],
					action: () => new CurrencyMappingModal(this.app, key, this.plugin.settings, async patch => {
						await this.plugin.updateSettings(patch);
						this.update();
					}).open(),
				})),
			] },
			{ type: 'group', heading: 'Metadata', items: [
				{ name: 'Always process all frontmatter', desc: 'Make every frontmatter property available to calculations.', control: { type: 'toggle', key: 'forceProcessAllFrontmatter' } },
				{ name: 'Enable cross-note references', desc: 'Read note properties with [[note]].property syntax.', control: { type: 'toggle', key: 'enableCrossNoteReferences' } },
			] },
			{ type: 'group', heading: 'Inline calculations', items: [
				{ name: 'Enable inline calculations', desc: 'Evaluate inline code that begins with a configured trigger.', control: { type: 'toggle', key: 'enableInlineNumerals' } },
				...inlineTriggerKeys.map((key, index) => ({ name: triggerNames[index],
					desc: 'Set a distinct trigger or leave empty to disable this mode.', aliases: [key],
					control: { type: 'text' as const, key, validate: (value: string) => settingError(this.plugin.settings, key, value) },
				})),
				{ name: 'Equation separator', desc: 'Show this text between the inline expression and result.', control: { type: 'text', key: 'inlineEquationSeparator' } },
			] },
			{ type: 'group', heading: 'Suggestions', items: [
				{ name: 'Suggest in math blocks', desc: 'Show completions while editing math blocks.', control: { type: 'toggle', key: 'provideSuggestions' } },
				{ name: 'Include functions and constants', desc: 'Include mathjs functions and constants in suggestions.', control: { type: 'toggle', key: 'suggestionsIncludeMathjsSymbols' } },
				{ name: 'Suggest Greek characters', desc: 'Complete Greek character names after a colon.', control: { type: 'toggle', key: 'enableGreekAutoComplete' } },
				{ name: 'Suggest in inline calculations', desc: 'Show completions while editing inline calculations.', control: { type: 'toggle', key: 'provideInlineSuggestions' } },
			] },
		];
	}
}
