///////////////////////////////////////////
// Imports
///////////////////////////////////////////

import NumeralsPlugin from "./main";
import { NumeralsSuggestor } from "./NumeralsSuggestor";
import { htmlToElements } from "./rendering/displayUtils";
import { NumeralsRenderStyle, NumeralsNumberFormat, NumeralsLayout } from "./numerals.types";

import {
    PluginSettingTab,
    App,
    Setting,
	ButtonComponent, TextComponent
 } from "obsidian";

///////////////////////////////////////////
// Settings Enums and Interfaces
///////////////////////////////////////////


///////////////////////////////////////////
// Settings Details
///////////////////////////////////////////

export const NumberalsNumberFormatSettingsStrings = {
	[NumeralsNumberFormat.System]: `System Formatted: ${(100000.1).toLocaleString()}`,
	[NumeralsNumberFormat.Fixed]: "Fixed: 100000.1",
	[NumeralsNumberFormat.Exponential]: "Exponential: 1.000001e+5",
	[NumeralsNumberFormat.Engineering]: "Engineering: 100.0001e+3",
	[NumeralsNumberFormat.Format_CommaThousands_PeriodDecimal]: "Formatted: 100,000.1",
	[NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal]: "Formatted: 100.000,1",
	[NumeralsNumberFormat.Format_SpaceThousands_CommaDecimal]: "Formatted: 100 000,1",
	[NumeralsNumberFormat.Format_Indian]: "Formatted: 1,00,000.1",
}

export const currencyCodesForDollarSign: {[key:string]: string} = {
	ARS: "Argentine Peso",
	AUD: "Australian Dollar",
    BBD: "Barbadian Dollar",
    BMD: "Bermudian Dollar",
    BND: "Brunei Dollar",
    BSD: "Bahamian Dollar",
	BZD: "Belize Dollar",
    CAD: "Canadian Dollar",
	CLP: "Chilean Peso",
	COP: "Colombian Peso",
    FJD: "Fijian Dollar",
    GYD: "Guyanese Dollar",
    HKD: "Hong Kong Dollar",
    JMD: "Jamaican Dollar",
    KYD: "Cayman Islands Dollar",
    LRD: "Liberian Dollar",
    MXN: "Mexican Peso",
    NAD: "Namibian Dollar",
    NZD: "New Zealand Dollar",
    SBD: "Solomon Islands Dollar",
    SGD: "Singapore Dollar",
    SRD: "Surinamese Dollar",
    TTD: "Trinidad and Tobago Dollar",
    TWD: "New Taiwan Dollar",
    USD: "United States Dollar",
	UYU: "Uruguayan Peso",
    XCD: "East Caribbean Dollar",
};

export const currencyCodesForYenSign: {[key:string]: string} = {
    JPY: "Japanese Yen",
    CNY: "Chinese Yuan",
    KRW: "Korean Won",
};

///////////////////////////////////////////
// Settings Tab
///////////////////////////////////////////

/**
 * Settings Tab for the Numerals Plugin
 * 
 * @export
 * @class NumeralsSettingTab
 * @extends {PluginSettingTab}
 * @property {NumeralsPlugin} plugin
 */
export class NumeralsSettingTab extends PluginSettingTab {
	plugin: NumeralsPlugin;

	constructor(app: App, plugin: NumeralsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h1', {text: 'Numerals Plugin Settings'});

		new Setting(containerEl)
		.setHeading()
		.setName('Layout and Render Settings');	

		new Setting(containerEl)
			.setName('Numerals Layout Style')
			.setDesc('Layout of math blocks in Live Preview and Reading mode')
			.addDropdown(dropDown => {
				dropDown.addOption(NumeralsLayout.TwoPanes, '2 Panes');
				dropDown.addOption(NumeralsLayout.AnswerRight, 'Answer to the right');
				dropDown.addOption(NumeralsLayout.AnswerBelow, 'Answer below each line');
				dropDown.addOption(NumeralsLayout.AnswerInline, 'Answer inline, beside input');				
				dropDown.setValue(this.plugin.settings.layoutStyle);
				dropDown.onChange(async (value) => {
					const layoutStyleStr = value as keyof typeof NumeralsLayout;
					this.plugin.settings.layoutStyle = NumeralsLayout[layoutStyleStr];
					await this.plugin.saveSettings();
				});
			});		

		new Setting(containerEl)
			.setName('Default Numerals Rendering Style')
			.setDesc('Choose how the input and results are rendered by default. Note that you can specify the rendering style on a per block basis, by using `math-plain`, ``math-tex``, or ``math-highlight``')
			.addDropdown(dropDown => {
				dropDown.addOption(NumeralsRenderStyle.Plain, 'Plain Text');
				dropDown.addOption(NumeralsRenderStyle.TeX, 'TeX Style');
				dropDown.addOption(NumeralsRenderStyle.SyntaxHighlight, 'Syntax Highlighting of Plain Text');
				dropDown.setValue(this.plugin.settings.defaultRenderStyle);
				dropDown.onChange(async (value) => {
					const renderStyleStr = value as keyof typeof NumeralsRenderStyle;
					this.plugin.settings.defaultRenderStyle = NumeralsRenderStyle[renderStyleStr]
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
		.setHeading()
		.setName('Auto-Complete Suggestion Settings');		

		new Setting(containerEl)
			.setName('Provide Auto-Complete Suggestions')
			.setDesc('Enable auto-complete suggestions when inside a math codeblock. Will base suggestions on variables in current codeblock, as well as mathjs functions and constants if enabled below (Disabling requires restart to take effect)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.provideSuggestions)
				.onChange(async (value) => {
					this.plugin.settings.provideSuggestions = value;
					if (value) {
						this.plugin.registerEditorSuggest(new NumeralsSuggestor(this.plugin));
					}
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Include Functions and Constants in Suggestions')
			.setDesc('Auto-complete suggestions will include mathjs functions, constants, and physical constants.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.suggestionsIncludeMathjsSymbols)
				.onChange(async (value) => {
					this.plugin.settings.suggestionsIncludeMathjsSymbols = value;
					await this.plugin.saveSettings();
				}));	
		new Setting(containerEl)
			.setName('Enable Greek Character Auto-Complete')
			.setDesc('Auto-complete suggestions for Greek characters by typing ":" and then greek letter name (e.g. `:alpha`).')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableGreekAutoComplete)
				.onChange(async (value) => {
					this.plugin.settings.enableGreekAutoComplete = value;
					await this.plugin.saveSettings();
				}));							
			
		new Setting(containerEl)
			.setHeading()
			.setName('Styling Settings');			

		new Setting(containerEl)
			.setName('Result Indicator')
			.setDesc('String to show preceeding the calculation result')
			.addText(text => text
				.setPlaceholder('" → "')
				.setValue(this.plugin.settings.resultSeparator)
				.onChange(async (value) => {
					this.plugin.settings.resultSeparator = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Alternating row color')
			.setDesc('Alternating rows are colored slightly differently to help differentiate between rows')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.alternateRowColor)
				.onChange(async (value) => {
					this.plugin.settings.alternateRowColor = value;
					await this.plugin.saveSettings();
				}));	

		new Setting(containerEl)
			.setName('Hide Result on Lines without Result Annotation')
			.setDesc('If a math block uses result annotation (`=>`) on any line, hide the results for lines that are not annotated as a result. If off, results of non-annotated lines will be shown in faint text color.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideLinesWithoutMarkupWhenEmitting)
				.onChange(async (value) => {
					this.plugin.settings.hideLinesWithoutMarkupWhenEmitting = value;
					await this.plugin.saveSettings();
				}));			

		// create new document fragment to be mult-line property text seperated by <br>
		const resultAnnotationMarkupDesc = document.createDocumentFragment();
		resultAnnotationMarkupDesc.append('Result Annotation markup (`=>`) is used to indicate which line is the result of the calculation. It can be used on any line, and can be used multiple times in a single block. If used, the result of the last line with the markup will be shown in the result column. If not used, the result of the last line will be shown in the result column.');
		
		new Setting(containerEl)
			.setName('Hide Result Annotation Markup in Input')
			.setDesc('Result Annotation markup (`=>`) will be hidden in the input when rendering the math block')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideEmitterMarkupInInput)
				.onChange(async (value) => {
					this.plugin.settings.hideEmitterMarkupInInput = value;
					await this.plugin.saveSettings();
				}));					

		// containerEl.createEl('h2', {text: 'Number Formatting'});
		// Dropdown for number formatting locale setting
		new Setting(containerEl)
			.setHeading()
			.setName("Number and Currency Formatting");

		new Setting(containerEl)
			.setName('Rendered Number Format')
			.setDesc(htmlToElements(`Choose how to format numbers in the results.<br>`
				+ `<b>System Formatted:</b> Use your local system settings for number formatting (Currently <code>${navigator.language}</code>)<br>`
				+ `<b>Fixed:</b> No thousands seperator and full precision.<br>`
				+ `<b>Exponential:</b> Always use exponential notation.<br>`				
				+ `<b>Engineering:</b> Exponential notation with exponent a multiple of 3.<br>`
				+ `<b>Formatted:</b> Forces a specific type of formatted notation.<br><br>`								
				+ `<i>Note:</i> <code>math-tex</code> mode will always use period as decimal seperator, regardless of locale.<br>`))
			.addDropdown(dropDown => { 
				// addOption for every option in NumberalsNumberFormatSettingsStrings
				for (const settingName in NumberalsNumberFormatSettingsStrings) {
					dropDown.addOption(settingName, NumberalsNumberFormatSettingsStrings[settingName as NumeralsNumberFormat]);
				}

				dropDown.setValue(this.plugin.settings.numberFormat);
				dropDown.onChange(async (value) => {
					const formatStyleStr = value as keyof typeof NumeralsNumberFormat;
					this.plugin.settings.numberFormat = NumeralsNumberFormat[formatStyleStr];
					await this.plugin.saveSettings();
					this.plugin.updateLocale();
				});
			})

		new Setting(containerEl)
			.setName('`$` symbol currency mapping')
			.setDesc('Choose the currency the `$` symbol maps to (requires Obsidian reload to take effect)')
				.addDropdown(dropDown => {
					// addOption for every currency in currencyCodesForDollarSign
					for (const currencyCode in currencyCodesForDollarSign) {
						dropDown.addOption(currencyCode, `${currencyCode} (${currencyCodesForDollarSign[currencyCode]})`);
					}
					dropDown.setValue(this.plugin.settings.dollarSymbolCurrency.currency);
					dropDown.onChange(async (value) => {
						this.plugin.settings.dollarSymbolCurrency.currency = value;
						await this.plugin.saveSettings();
					});
			});	
			
		new Setting(containerEl)
			.setName('`¥` symbol currency mapping')
			.setDesc('Choose the currency the `¥` symbol maps to (requires Obsidian reload to take effect)')
				.addDropdown(dropDown => {
					// addOption for every currency in currencyCodesForYenSign
					for (const currencyCode in currencyCodesForYenSign) {
						dropDown.addOption(currencyCode, `${currencyCode} (${currencyCodesForYenSign[currencyCode]})`);
					}
					dropDown.setValue(this.plugin.settings.yenSymbolCurrency.currency);
					dropDown.onChange(async (value) => {
						this.plugin.settings.yenSymbolCurrency.currency = value;
						await this.plugin.saveSettings();
					});
				});

				let currencySaveButton: ButtonComponent | null;
				let currencySymbolInput: TextComponent | null;
				let currencyCodeInput: TextComponent | null;
				new Setting(containerEl)
					.setName('Custom currency mapping')
					.setDesc('Specify a custom currency. Note that this may be used for custom mapping of `$` and `¥`. Requires Obsidian reload to take effect')
					.addText(text => { text
						.setPlaceholder('symbol')
						.setValue(this.plugin.settings.customCurrencySymbol?.symbol ?? "")
						.onChange(async (value) => {
							if(
								(
									(value.length == 0 && !currencyCodeInput?.getValue())
								||
									(value.length >= 1 && currencyCodeInput?.getValue())
								) && currencySaveButton) {
								if (value.match(/^\p{Sc}$/u) || value.length == 0) {
									currencySaveButton.setDisabled(false);
									currencySaveButton.buttonEl.style.color = "var(--text-normal)";
									currencySaveButton.setButtonText('Save');
								} else {
									currencySaveButton.setDisabled(true);
									currencySaveButton.buttonEl.style.color = "var(--text-error)";
									currencySaveButton.setButtonText('Error');
								}
							} else if (currencySaveButton) {
								currencySaveButton.setDisabled(true);
								currencySaveButton.buttonEl.style.color = "var(--text-faint)";
								currencySaveButton.setButtonText('Save');
							}		
						});					
						text.inputEl.setAttribute("maxlength", "1");
						text.inputEl.style.width = "5em";
						text.inputEl.style.textAlign = "center";
						currencySymbolInput = text;
					})
					.addText(text => { text
						.setPlaceholder('code')				
						.setValue(this.plugin.settings.customCurrencySymbol?.currency ?? "")
						.onChange(async (value) => {
							if(
								(
									(value.length == 0 && !currencySymbolInput?.getValue())
								||
									(value.length >= 1 && currencySymbolInput?.getValue())
								) && currencySaveButton) {
								if (currencySymbolInput?.getValue().match(/^\p{Sc}$/u) || value.length == 0) {
									currencySaveButton.setDisabled(false);
									currencySaveButton.buttonEl.style.color = "var(--text-normal)";
									currencySaveButton.setButtonText('Save');
								} else {
									currencySaveButton.setDisabled(true);
									currencySaveButton.buttonEl.style.color = "var(--text-error)";
									currencySaveButton.setButtonText('Error');
								}
							} else if (currencySaveButton) {
								currencySaveButton.setDisabled(true);
								currencySaveButton.buttonEl.style.color = "var(--text-faint)";
								currencySaveButton.setButtonText('Save');
							}		
						});				
						text.inputEl.setAttribute("maxlength", "3");
						text.inputEl.style.width = "6em";
						text.inputEl.style.textAlign = "center";
						currencyCodeInput = text;					
					})		
					.addButton(button => { button
						.setButtonText('Save')
						.setDisabled(true)
						.setTooltip('Save custom currency mapping')
						.onClick(async (evt) => {
							if (currencySymbolInput && currencyCodeInput) {
								const currencySymbol = currencySymbolInput.getValue();
								const currencyCode = currencyCodeInput.getValue();
								if(currencySymbol.match(/^\p{Sc}$/u)) {
									this.plugin.settings.customCurrencySymbol = {
										symbol: currencySymbol,
										currency: currencyCode,
										unicode: "x" + currencySymbol
															.charCodeAt(0)
															.toString(16)
															.toUpperCase()
															.padStart(4, '0'),
										name: "custom",
									}
								} else if (currencySymbol.length == 0) {
									this.plugin.settings.customCurrencySymbol = null;
								}
								await this.plugin.saveSettings();
								console.log(this.plugin.settings.customCurrencySymbol);
								button.setDisabled(true);
								button.buttonEl.style.color = "var(--text-faint)";
								button.setButtonText('✓');
								setTimeout(() => {
									button.setButtonText('Save');
								}, 1000);
								this.plugin.updateCurrencyMap();
							}
						});
						button.buttonEl.style.color = "var(--text-faint)";
						button.buttonEl.style.width = "4em";				
						currencySaveButton = button;
									
					});				
			
		new Setting(containerEl)
		.setHeading()
		.setName('Obsidian Integration');	

		new Setting(containerEl)
			.setName('Always Process All Frontmatter')
			.setDesc(htmlToElements(`Always process all frontmatter values and make them available as variables in <code>\`math\`</code> blocks<br>`
				+ `<br><b><i>Note:</i></b> To process frontmatter values on a per file and/or per property basis, set a value for the <code>\`numerals\`</code> property in a file's frontmatter.`
				+ ` Supported values are:<ul><li><code>all</code></li><li>specific property to process</li><li>a list/array of properties to process</li></ul><br>`))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.forceProcessAllFrontmatter)
				.onChange(async (value) => {
					this.plugin.settings.forceProcessAllFrontmatter = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setHeading()
			.setName('Inline Numerals');

		new Setting(containerEl)
			.setName('Enable Inline Numerals')
			.setDesc(htmlToElements(
				`Evaluate math expressions in inline code when prefixed with a trigger string.<br>`
				+ `For example: <code>=: 3ft in inches</code> renders as the result, `
				+ `and <code>==: 3ft + 2ft</code> shows the equation and result.`
			))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableInlineNumerals)
				.onChange(async (value) => {
					this.plugin.settings.enableInlineNumerals = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Result-Only Trigger')
			.setDesc(htmlToElements(
				`Prefix for inline code that shows only the result.<br>`
				+ `Example: <code>=: 3 + 2</code> renders as <b>5</b>`
			))
			.addText(text => text
				.setPlaceholder('=:')
				.setValue(this.plugin.settings.inlineResultTrigger)
				.onChange(async (value) => {
					this.plugin.settings.inlineResultTrigger = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Equation Trigger')
			.setDesc(htmlToElements(
				`Prefix for inline code that shows input and result.<br>`
				+ `Example: <code>==: 3 + 2</code> renders as <b>3 + 2 = 5</b>`
			))
			.addText(text => text
				.setPlaceholder('==:')
				.setValue(this.plugin.settings.inlineEquationTrigger)
				.onChange(async (value) => {
					this.plugin.settings.inlineEquationTrigger = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Equation Separator')
			.setDesc('String shown between the expression and result in equation mode')
			.addText(text => text
				.setPlaceholder(' = ')
				.setValue(this.plugin.settings.inlineEquationSeparator)
				.onChange(async (value) => {
					this.plugin.settings.inlineEquationSeparator = value;
					await this.plugin.saveSettings();
				}));
	}
}
