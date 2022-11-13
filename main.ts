import { App, finishRenderMath, Notice, Plugin, PluginSettingTab, renderMath, Setting, loadMathJax} from 'obsidian';
import * as math from `mathjs`;

enum NumeralsLayout { 
	TwoPanes,
	AnswerRight,
	AnswerBelow,
	AnswerInline,
}

const numeralsLayoutClasses = {
	[NumeralsLayout.TwoPanes]: 		"numerals-panes",
	[NumeralsLayout.AnswerRight]: 	"numerals-answer-right",
	[NumeralsLayout.AnswerBelow]: 	"numerals-answer-below",
	[NumeralsLayout.AnswerInline]: 	"numerals-answer-inline",	
}

enum NumeralsRenderStyle {
	Plain = "Plain",
	TeX ="Tex",
	SyntaxHighlight = "SyntaxHighlight",
}

const numeralsRenderStyleClasses = {
	[NumeralsRenderStyle.Plain]: 			"numerals-plain",
	[NumeralsRenderStyle.TeX]: 			 	"numerals-tex",
	[NumeralsRenderStyle.SyntaxHighlight]: 	"numerals-syntax",
}

// TODO: Add a switch for only rendering input

interface NumeralsSettings {
	resultSeparator: string;
	layoutStyle: NumeralsLayout;
	alternateRowColor: boolean;
	renderStyle: NumeralsRenderStyle;
}

interface CurrencyType {
	symbol: string;
	unicode: string;
	currency: string;
	name: string;
}

const DEFAULT_SETTINGS: NumeralsSettings = {
	resultSeparator: " → ",
	layoutStyle: NumeralsLayout.TwoPanes,
	alternateRowColor: true,
	renderStyle: NumeralsRenderStyle.Plain,
}


const moneyTypes: CurrencyType[] = [
	{	symbol: "$", unicode: "x024", currency: "USD", name: "dollar"},
	{	symbol: "€", unicode: "x20AC", currency: "EUR", name: "euro"},
	{	symbol: "£", unicode: "x00A3", currency: "GBP", name: "pound"},
	{	symbol: "¥", unicode: "x00A5", currency: "JPY", name: "yen"},
];

for (let moneyType of moneyTypes) {
	math.createUnit(moneyType.currency, {aliases:[moneyType.currency.toLowerCase(), moneyType.symbol]});
}

// Modify mathjs internal functions to allow for use of currency symbols
const currencySymbols = moneyTypes.map(m => m.symbol);
const isAlphaOriginal = math.parse.isAlpha;
math.parse.isAlpha = function (c, cPrev, cNext) {
	return isAlphaOriginal(c, cPrev, cNext) || currencySymbols.includes(c)
	};	

const isUnitAlphaOriginal = math.Unit.isValidAlpha;
math.Unit.isValidAlpha = function (c, cPrev, cNext) {
	return isUnitAlphaOriginal(c, cPrev, cNext) || currencySymbols.includes(c)
	};			

const currencyPreProcessors = moneyTypes.map(m => {
	return {regex: RegExp('\\' + m.symbol + '([\\d\\.]+)','g'), replaceStr: '$1 ' + m.currency}
})

const preProcessors = [
	// {regex: /\$((\d|\.|(,\d{3}))+)/g, replace: '$1 USD'}, // Use this if commas haven't been removed already
	{regex: /,(\d{3})/g, replaceStr: '$1'}, // remove thousands seperators. Will be wrong for add(100,100)
	...currencyPreProcessors
];

function numberFormatter(value:number) {
	return value.toLocaleString();
}

function texCurrencyReplacement(input_tex:string) {
	for (let moneyType of moneyTypes) {
		input_tex = input_tex.replace(RegExp("\\\\*\\"+moneyType.symbol,'g'),"\\" + moneyType.name);
	}
	return input_tex
}

function htmlToElements(html:string) {
	var template = document.createElement('template');
	template.innerHTML = html;
	const elements = template.content.children;
	return elements;
}

async function mathjaxLoop(container: HTMLElement, value: string) {
	const html = renderMath(value, true);
	await finishRenderMath()

	// container.empty();
	container.append(html);
}

export default class NumeralsPlugin extends Plugin {
	settings: NumeralsSettings;

	async numeralsMathBlockHandler(type: NumeralsRenderStyle, source: string, el: HTMLElement, ctx): Promise<any> {		

		const blockRenderStyle: NumeralsRenderStyle = type ? type : this.settings.renderStyle;
		
		el.toggleClass("numerals-block", true);
		el.toggleClass(numeralsLayoutClasses[this.settings.layoutStyle], true);
		el.toggleClass(numeralsRenderStyleClasses[blockRenderStyle], true);			
		el.toggleClass("numerals-alt-row-color", this.settings.alternateRowColor)
	
		let processedSource:string = source;
		for (let processor of preProcessors ) {
			processedSource = processedSource.replace(processor.regex, processor.replaceStr)
		}
	
		const rawRows: string[] = source.split("\n");
		const rows: string[] = processedSource.split("\n");
		
		let errorMsg = null;
		let errorInput = '';
	
		let results: string[] = [];
		let inputs: string[] = [];			
		let scope = {};
		
		try {
			for (var row of rows.slice(0,-1)) { // Last row may be empty
				results.push(math.evaluate(row, scope));
				inputs.push(row); // Only pushes if evaluate is successful
			}

			const lastRow = rows.slice(-1)[0];
			if (lastRow != '') { // Last row is always empty in reader view
					results.push(math.evaluate(lastRow, scope));
					inputs.push(lastRow); // Only pushes if evaluate is successful
				}

		} catch (error) {
			errorMsg = error;
			errorInput = row;
		}	
						
		for (let i in inputs) {
			const line = el.createEl("div", {cls: "numerals-line"});
			const emptyLine = (results[i] === undefined)
	
			switch(blockRenderStyle) {
				case NumeralsRenderStyle.Plain: {
					let rawInputSansComment = rawRows[i].replace(/#.+$/, "")
					let inputText = emptyLine ? rawRows[i] : rawInputSansComment;
					var inputElement = line.createEl("span", { text: inputText, cls: "numerals-input"});
					
					const formattedResult = !emptyLine ? this.settings.resultSeparator + math.format(results[i], numberFormatter) : '\xa0';
					var resultElement = line.createEl("span", { text: formattedResult, cls: "numerals-result" });
					break;
				} case NumeralsRenderStyle.TeX: {
					let inputText = emptyLine ? rawRows[i] : "";
					var inputElement = line.createEl("span", {text: inputText, cls: "numerals-input"});
					const resultContent = !emptyLine ? "" : '\xa0';
					var resultElement = line.createEl("span", { text: resultContent, cls: "numerals-result" });
					if (!emptyLine) {
						// Input to Tex
						let input_tex:string = math.parse(inputs[i]).toTex();
						var texElement = inputElement.createEl("span", {cls: "numerals-tex"})

						input_tex = texCurrencyReplacement(input_tex);
						mathjaxLoop(texElement, input_tex);

						// Result to Tex
						var texElement = resultElement.createEl("span", {cls: "numerals-tex"})
						let processedResult:string = math.format(results[i], numberFormatter);
						for (let processor of preProcessors ) {
							processedResult = processedResult.replace(processor.regex, processor.replaceStr)
						}
						let texResult = math.parse(processedResult).toTex() // TODO: Add custom handler for numbers to get good localeString formatting
						texResult = texCurrencyReplacement(texResult);
						mathjaxLoop(texElement, texResult);
					}
					break;
				} case NumeralsRenderStyle.SyntaxHighlight: {
					let inputText = emptyLine ? rawRows[i] : "";
					var inputElement = line.createEl("span", {text: inputText, cls: "numerals-input"});
					if (!emptyLine) {
						let input_html = htmlToElements(math.parse(inputs[i]).toHTML())
						for (const element of input_html) {
							inputElement.createEl("span", {cls: element.className, text: element.innerHTML})
						}
					}

					const formattedResult = !emptyLine ? this.settings.resultSeparator + math.format(results[i], numberFormatter) : '\xa0';
					var resultElement = line.createEl("span", { text: formattedResult, cls: "numerals-result" });

					break;
				}
			}
	
			if (!emptyLine) {
				let inlineComment = rawRows[i].match(/#.+$/);
				if (inlineComment){
					inputElement.createEl("span", {cls: "numerals-inline-comment", text:inlineComment[0]})
				}
			} else {
				resultElement.toggleClass("numerals-empty", true);
				inputElement.toggleClass("numerals-empty", true);
				resultElement.setText('\xa0');
			}
		}
	
	
		if (errorMsg) {			
			const line = el.createEl("div", {cls: "numerals-error-line"});
			const inputElement = line.createEl("span", { text: errorInput, cls: "numerals-input"});
			const resultElement = line.createEl("span", {cls: "numerals-result" });
			resultElement.createEl("span", {cls:"numerals-error-name", text: errorMsg.name + ":"});
			resultElement.createEl("span", {cls:"numerals-error-message", text: errorMsg.message});		
		}
	
	};


	async onload() {
		await this.loadSettings();

		// // DEBUGGING PURPOSES ONLY: Add command to reset plugin settings
		this.addCommand({
			id: 'reset-numerals-settings',
			name: 'Reset Numerals Settings to Defaults',
			callback: async () => {
					this.settings = DEFAULT_SETTINGS;
					await this.saveSettings();
					new Notice('All Numerals settings reset to defaults')					
			}
		});		

		// Load MathJax for TeX Rendering
		await loadMathJax();

		// Configure currency commands in MathJax
		const configureCurrencyStr =  moneyTypes.map(m => '\\def\\' + m.name + '{\\unicode{' + m.unicode + '}}').join('\n');
		const currencyTex = renderMath(configureCurrencyStr, true);

		
		this.registerMarkdownCodeBlockProcessor("math", this.numeralsMathBlockHandler.bind(this, null));
		this.registerMarkdownCodeBlockProcessor("Math", this.numeralsMathBlockHandler.bind(this, null));		
		this.registerMarkdownCodeBlockProcessor("math-plain", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.Plain));		
		this.registerMarkdownCodeBlockProcessor("math-tex", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX));
		this.registerMarkdownCodeBlockProcessor("math-TeX", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX));
		this.registerMarkdownCodeBlockProcessor("math-highlight", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.SyntaxHighlight));

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

		containerEl.createEl('h2', {text: 'Settings for my *Numerals* plugin.'});

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
					this.plugin.settings.layoutStyle = value;
					await this.plugin.saveSettings();
				});
			});		

		new Setting(containerEl)
			.setName('Default Numerals Rendering Style')
			.setDesc('Choose how the input and results are rendered by default. Note that you can specify the rendering style on a per block basis, by using \`math-plain\`, \`math-tex\`, or \`math-highlight\`')
			.addDropdown(dropDown => {
				dropDown.addOption(NumeralsRenderStyle.Plain, 'Plain Text');
				dropDown.addOption(NumeralsRenderStyle.TeX, 'TeX Style');
				dropDown.addOption(NumeralsRenderStyle.SyntaxHighlight, 'Syntax Highlighting of Plain Text');
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
