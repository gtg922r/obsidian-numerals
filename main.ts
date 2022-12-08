import { App, finishRenderMath, Notice, Plugin, PluginSettingTab, renderMath, Setting, loadMathJax, sanitizeHTMLToDom} from 'obsidian';
import * as math from 'mathjs';

enum NumeralsLayout { 
	TwoPanes = "TwoPanes",
	AnswerRight = "AnswerRight",
	AnswerBelow = "AnswerBelow",
	AnswerInline = "AnswerInline",
}

const numeralsLayoutClasses = {
	[NumeralsLayout.TwoPanes]: 		"numerals-panes",
	[NumeralsLayout.AnswerRight]: 	"numerals-answer-right",
	[NumeralsLayout.AnswerBelow]: 	"numerals-answer-below",
	[NumeralsLayout.AnswerInline]: 	"numerals-answer-inline",	
}

enum NumeralsRenderStyle {
	Plain = "Plain",
	TeX ="TeX",
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
	defaultRenderStyle: NumeralsRenderStyle;
	hideLinesWithoutMarkupWhenEmitting: boolean;
	hideEmitterMarkupInInput: boolean;
}

const DEFAULT_SETTINGS: NumeralsSettings = {
	resultSeparator: " → ",
	layoutStyle: NumeralsLayout.TwoPanes,
	alternateRowColor: true,
	defaultRenderStyle: NumeralsRenderStyle.Plain,
	hideLinesWithoutMarkupWhenEmitting: true,
	hideEmitterMarkupInInput: true,
}

interface CurrencyType {
	symbol: string;
	unicode: string;
	currency: string;
	name: string;
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

// 														@ts-ignore
const isUnitAlphaOriginal = math.Unit.isValidAlpha; // 	@ts-ignore
math.Unit.isValidAlpha =
function (c: string, cPrev: any, cNext: any) {
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

/**
 * Converts a string of HTML into a DocumentFragment continaing a sanitized collection array of DOM elements.
 *
 * @param html The HTML string to convert.
 * @returns A DocumentFragment contaning DOM elements.
 */
 function htmlToElements(html: string): DocumentFragment {
	const sanitizedHTML = sanitizeHTMLToDom(html);
	return sanitizedHTML;
  }

async function mathjaxLoop(container: HTMLElement, value: string) {
	const html = renderMath(value, true);
	await finishRenderMath()

	// container.empty();
	container.append(html);
}

export default class NumeralsPlugin extends Plugin {
	settings: NumeralsSettings;

	async numeralsMathBlockHandler(type: NumeralsRenderStyle, source: string, el: HTMLElement, ctx: any): Promise<any> {		

		const blockRenderStyle: NumeralsRenderStyle = type ? type : this.settings.defaultRenderStyle;
		
		el.toggleClass("numerals-block", true);
		el.toggleClass(numeralsLayoutClasses[this.settings.layoutStyle], true);
		el.toggleClass(numeralsRenderStyleClasses[blockRenderStyle], true);			
		el.toggleClass("numerals-alt-row-color", this.settings.alternateRowColor)
	
		// Pre-process input
	
		const rawRows: string[] = source.split("\n");
		let processedSource:string = source;

		// find every line that ends with `=>` (ignore any whitespace or comments after it)
		const emitter_lines: number[] = [];
		for (let i = 0; i < rawRows.length; i++) {
			if (rawRows[i].match(/=>\s*(#.*)?$/)) { 
				emitter_lines.push(i);
			}
		}

		// if there are any emitter lines then add the class `numerals-emitters-present` to the block
		if (emitter_lines.length > 0) {
			el.toggleClass("numerals-emitters-present", true);
			el.toggleClass("numerals-hide-non-emitters", this.settings.hideLinesWithoutMarkupWhenEmitting);
		}

		// TODO Need to decide if want to remove emitter indicator from input text
		// TODO need to decide if want to change (or drop) the seperator if there is an emitter

		// remove `=>` at the end of lines (preserve comments)
		processedSource = processedSource.replace(/(\s*=>)(\s*)(#.*)?$/gm,"$2$3") 
			
		for (let processor of preProcessors ) {
			processedSource = processedSource.replace(processor.regex, processor.replaceStr)
		}
		
		// Process input through mathjs

		let errorMsg = null;
		let errorInput = '';

		const rows: string[] = processedSource.split("\n");
		let results: string[] = [];
		let inputs: string[] = [];			
		let scope = {};
		
		for (let row of rows.slice(0,-1)) { // Last row may be empty
			try {
				results.push(math.evaluate(row, scope));
				inputs.push(row); // Only pushes if evaluate is successful
			} catch (error) {
				errorMsg = error;
				errorInput = row;
				break;
			}
		}

		const lastRow = rows.slice(-1)[0];
		if (lastRow != '') { // Last row is always empty in reader view
			try {
				results.push(math.evaluate(lastRow, scope));
				inputs.push(lastRow); // Only pushes if evaluate is successful
			} catch (error) {
				errorMsg = error;
				errorInput = lastRow;
			}
		}	
						
		for (let i = 0; i < inputs.length; i++) {
			const line = el.createEl("div", {cls: "numerals-line"});
			const emptyLine = (results[i] === undefined)

			// if line is an emitter lines, add numerals-emitter class	
			if (emitter_lines.includes(i)) {
				line.toggleClass("numerals-emitter", true);
			}

			// if hideEmitters setting is true, remove => from the raw text (already removed from processed text)
			if (this.settings.hideLinesWithoutMarkupWhenEmitting) {
				rawRows[i] = rawRows[i].replace(/(\s*=>)(\s*)(#.*)?$/gm,"$2$3");
			}
	
			let inputElement: HTMLElement, resultElement: HTMLElement;
			switch(blockRenderStyle) {
				case NumeralsRenderStyle.Plain: {
					let rawInputSansComment = rawRows[i].replace(/#.+$/, "")
					let inputText = emptyLine ? rawRows[i] : rawInputSansComment;
					inputElement = line.createEl("span", { text: inputText, cls: "numerals-input"});
					
					const formattedResult = !emptyLine ? this.settings.resultSeparator + math.format(results[i], numberFormatter) : '\xa0';
					resultElement = line.createEl("span", { text: formattedResult, cls: "numerals-result" });

					break;
				} case NumeralsRenderStyle.TeX: {
					let inputText = emptyLine ? rawRows[i] : ""; // show comments from raw text if no other input
					inputElement = line.createEl("span", {text: inputText, cls: "numerals-input"});
					const resultContent = !emptyLine ? "" : '\xa0';
					resultElement = line.createEl("span", { text: resultContent, cls: "numerals-result" });
					if (!emptyLine) {
						// Input to Tex
						let input_tex:string = math.parse(inputs[i]).toTex();
						let inputTexElement = inputElement.createEl("span", {cls: "numerals-tex"})

						input_tex = texCurrencyReplacement(input_tex);
						mathjaxLoop(inputTexElement, input_tex);

						// Result to Tex
						let resultTexElement = resultElement.createEl("span", {cls: "numerals-tex"})
						let processedResult:string = math.format(results[i], numberFormatter);
						for (let processor of preProcessors ) {
							processedResult = processedResult.replace(processor.regex, processor.replaceStr)
						}
						let texResult = math.parse(processedResult).toTex() // TODO: Add custom handler for numbers to get good localeString formatting
						texResult = texCurrencyReplacement(texResult);
						mathjaxLoop(resultTexElement, texResult);
					}
					break;
				} case NumeralsRenderStyle.SyntaxHighlight: {
					let inputText = emptyLine ? rawRows[i] : ""; // show comments from raw text if no other input
					inputElement = line.createEl("span", {text: inputText, cls: "numerals-input"});
					if (!emptyLine) {
						const input_elements:DocumentFragment = htmlToElements(math.parse(inputs[i]).toHTML())
						inputElement.appendChild(input_elements);
					}

					const formattedResult = !emptyLine ? this.settings.resultSeparator + math.format(results[i], numberFormatter) : '\xa0';
					resultElement = line.createEl("span", { text: formattedResult, cls: "numerals-result" });

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
		// this.addCommand({
		// 	id: 'reset-numerals-settings',
		// 	name: 'Reset Numerals Settings to Defaults',
		// 	callback: async () => {
		// 			this.settings = DEFAULT_SETTINGS;
		// 			await this.saveSettings();
		// 			new Notice('All Numerals settings reset to defaults')					
		// 	}
		// });		

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

	async loadSettings() {

		let loadData = await this.loadData();

		// Check for signature of old setting format, then port to new setting format
		if (loadData.layoutStyle == undefined) {
			const oldRenderStyleMap = {
				1: NumeralsLayout.TwoPanes,
				2: NumeralsLayout.AnswerRight,
				3: NumeralsLayout.AnswerBelow}

			loadData.layoutStyle = oldRenderStyleMap[loadData.renderStyle as keyof typeof oldRenderStyleMap];
			if(loadData.layoutStyle) {
				delete loadData.renderStyle
				this.settings = loadData
				this.saveSettings();			
			} else {
				console.log("Numerals: Error porting old layout style")
			}

		} else if (loadData.layoutStyle in [0, 1, 2, 3]) {
			const oldLayoutStyleMap = {
				0: NumeralsLayout.TwoPanes,
				1: NumeralsLayout.AnswerRight,
				2: NumeralsLayout.AnswerBelow,
				3: NumeralsLayout.AnswerInline,
			}			

			loadData.layoutStyle = oldLayoutStyleMap[loadData.layoutStyle as keyof typeof oldLayoutStyleMap];
			if(loadData.layoutStyle) {
				this.settings = loadData
				this.saveSettings();			
			} else {
				console.log("Numerals: Error porting old layout style")
			}		
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadData);

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

		containerEl.createEl('h2', {text: 'Numerals Plugin Settings'});

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
					let layoutStyleStr = value as keyof typeof NumeralsLayout;
					this.plugin.settings.layoutStyle = NumeralsLayout[layoutStyleStr];
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
				dropDown.setValue(this.plugin.settings.defaultRenderStyle);
				dropDown.onChange(async (value) => {
					console.log(value)
					let renderStyleStr = value as keyof typeof NumeralsRenderStyle;
					console.log(renderStyleStr)
					this.plugin.settings.defaultRenderStyle = NumeralsRenderStyle[renderStyleStr]
					console.log(NumeralsRenderStyle)
					console.log(NumeralsRenderStyle[renderStyleStr])
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

		new Setting(containerEl)
			.setName('Hide Result on Lines without Emitter Markups')
			.setDesc('When math block uses result emitter markup (`=>`) on any line, only lines with emitter markup will be shown in the result pane. If off, non-emitter lines will be shown in faint text color.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideLinesWithoutMarkupWhenEmitting)
				.onChange(async (value) => {
					this.plugin.settings.hideLinesWithoutMarkupWhenEmitting = value;
					await this.plugin.saveSettings();
				}));			
		new Setting(containerEl)
			.setName('Hide Emitter Markup in Input')
			.setDesc('Emitter markup (`=>`) will be hidden in the input pane when rendering the math block')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideEmitterMarkupInInput)
				.onChange(async (value) => {
					this.plugin.settings.hideEmitterMarkupInInput = value;
					await this.plugin.saveSettings();
				}));					
				

				
	}
}
