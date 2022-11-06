import { App, DropdownComponent, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import * as math from `mathjs`;


// Remember to rename these classes and interfaces!

interface NumeralsSettings {
	resultSeparator: string;
	renderStyle: number;
	alternateRowColor: boolean;
}

const DEFAULT_SETTINGS: NumeralsSettings = {
	resultSeparator: " → ",
	renderStyle: 1,
	alternateRowColor: true
}

export default class NumeralsPlugin extends Plugin {
	settings: NumeralsSettings;

	async onload() {
		await this.loadSettings();
		
	
		// ** Mathjs Setup ** //
		const isUnitAlphaOriginal = math.Unit.isValidAlpha;
		math.Unit.isValidAlpha = function (c, cPrev, cNext) {
			return isUnitAlphaOriginal(c, cPrev, cNext) || ['$', '€'].includes(c)
			};	
		math.createUnit('USD', {aliases:['usd', '$']});

		const preProcessors = [
			// {regex: /\$((\d|\.|(,\d{3}))+)/g, replace: '$1 USD'}, // Use this if commas haven't been removed already
			{regex: /,(\d{3})/g, replaceStr: '$1'}, // remove thousands seperators. Will be wrong for add(100,100)
			{regex: /\$([\d\.]+)/g, replaceStr: '$1 USD'}, // convert $### to ### USD. Assumes commas removed
		];

		function numberFormatter(value:number) {
			return value.toLocaleString();
		}

		this.registerMarkdownCodeBlockProcessor("math", (source, el, ctx) => {
			el.toggleClass("numerals-panes", 		this.settings.renderStyle == 1)
			el.toggleClass("numerals-answer-right", this.settings.renderStyle == 2)
			el.toggleClass("numerals-answer-below", this.settings.renderStyle == 3)						

			el.toggleClass("numerals-alt-row-color", this.settings.alternateRowColor)

			let processedSource = source;
			for (let processor of preProcessors ) {
				processedSource = processedSource.replace(processor.regex, processor.replaceStr)
			}

			const rows = processedSource.split("\n");
			const rawRows = source.split("\n");

			try {
				const results = math.evaluate(rows);	
				
				for (let i = 0; i < rows.length; i++) {
					const line = el.createEl("div", {cls: "numerals-line"});
					const inputElement = line.createEl("span", { text: rawRows[i], cls: "numerals-input"});
	
					const emptyLine = (results[i] === undefined)
					const formattedResult = !emptyLine ? this.settings.resultSeparator + math.format(results[i], numberFormatter) : '\xa0';
					const resultElement = line.createEl("span", { text: formattedResult, cls: "numerals-result" });
	
					resultElement.toggleClass("numerals-empty", emptyLine);
					inputElement.toggleClass("numerals-empty", emptyLine);
	
				}				

			} catch (error) {
				el.createEl("div", {cls: "numerals-error-line"});
				el.createEl("span", {cls:"numerals-error-name", text: error.name + ":"});
				el.createEl("span", {cls:"numerals-error-message", text: error.message});		
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new NumeralsSettingTab(this.app, this));

	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}



class NumeralsSettingTab extends PluginSettingTab {
	plugin: NumeralsPlugin;

	constructor(app: App, plugin: NumeralsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('Numerals Render Style')
			.setDesc('Style of results rendering in Live Preview and Reading mode')
			.addDropdown(dropDown => {
				dropDown.addOption(1, '2 Panes');
				dropDown.addOption(2, 'Answer to the right');
				dropDown.addOption(3, 'Answer below each line');
				dropDown.setValue(this.plugin.settings.renderStyle);
				dropDown.onChange(async (value) => {
					this.plugin.settings.renderStyle = value;
					await this.plugin.saveSettings();
				});
			});		

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

				
	}
}
