import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import * as math from `mathjs`;


// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

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
			let processedSource = source;
			for (let processor of preProcessors ) {
				processedSource = processedSource.replace(processor.regex, processor.replaceStr)
			}
			// const preprocessRegex = /(?:\$)([\d,\.]+)/g
			// const replaceString = '$1 USD' // Delete "$" and append USD to any currency
			// const processedSource = source.replace(preprocessRegex, replaceString)

			// const rows = processedSource.split("\n").filter((row) => row.length > 0);
			// const rawRows = source.split("\n").filter((row) => row.length > 0);
			const rows = processedSource.split("\n");
			const rawRows = source.split("\n");
			const results = math.evaluate(rows);

			for (let i = 0; i < rows.length; i++) {
				const line = el.createEl("div", {cls: "numberpad-line"})
				line.createEl("span", { text: rawRows[i], cls: "numberpad-input"});
				// line.createSpan( {text: " → "}, cls: "numberpad-sep");
				// const formattedResult = math.format(results[i], {upperExp: 7, precision: 8});
				const emptyLine = (results[i] === undefined)
				// const formattedResult = !emptyLine ? " → " + math.format(results[i], numberFormatter) : '\xa0';
				const formattedResult = !emptyLine ? math.format(results[i], numberFormatter) : '\xa0';				
				line.createEl("span", { text: formattedResult, cls: "numberpad-result" });
				// console.log(math.parse(rows[i]).toHTML())			  
			}



			// // *** Original Working with indepdent lines ***
			// for (let i = 0; i < rows.length; i++) {
			// 	const line = el.createEl("div", {cls: "numberpad-line"})

			// 	const result = evaluate(rows[i])

			// 	line.createEl("span", { text: rows[i], cls: "numberpad-input"});
			// 	// line.createSpan( {text: " → "}, cls: "numberpad-sep");
			// 	line.createEl("span", { text: " → " + evaluate(rows[i]), cls: "numberpad-result" });			  
			// }
		});

		// *********** START Sample Plugin Code *********** //

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// *********** END Sample Plugin Code *********** //
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

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
