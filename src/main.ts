import { NumeralsSuggestor } from "./NumeralsSuggestor";
import { unescapeSubscripts, processFrontmatter } from "./numeralsUtilities";

import {
	finishRenderMath,
	Plugin,
	renderMath,
	loadMathJax,
	sanitizeHTMLToDom,
	MarkdownPostProcessorContext,
} from "obsidian";
// if use syntax tree directly will need "@codemirror/language": "^6.3.2", // Needed for accessing syntax tree
// import {syntaxTree, tokenClassNodeProp} from '@codemirror/language';

import * as math from 'mathjs';

import { 
	NumeralsSettingTab,
	NumeralsLayout,
	NumeralsRenderStyle,
	NumeralsNumberFormat,
	currencyCodesForDollarSign,
	currencyCodesForYenSign,
	NumeralsSettings,
	DEFAULT_SETTINGS,
 } from "./settings";

const numeralsLayoutClasses = {
	[NumeralsLayout.TwoPanes]: 		"numerals-panes",
	[NumeralsLayout.AnswerRight]: 	"numerals-answer-right",
	[NumeralsLayout.AnswerBelow]: 	"numerals-answer-below",
	[NumeralsLayout.AnswerInline]: 	"numerals-answer-inline",	
}

const numeralsRenderStyleClasses = {
	[NumeralsRenderStyle.Plain]: 			"numerals-plain",
	[NumeralsRenderStyle.TeX]: 			 	"numerals-tex",
	[NumeralsRenderStyle.SyntaxHighlight]: 	"numerals-syntax",
}

// TODO: Add a switch for only rendering input
interface CurrencyType {
	symbol: string;
	unicode: string;
	name: string;
	currency: string;
}

interface StringReplaceMap {
	regex: RegExp;
	replaceStr: string;
}

const defaultCurrencyMap: CurrencyType[] = [
	{	symbol: "$", unicode: "x024", 	name: "dollar", currency: "USD"},
	{	symbol: "€", unicode: "x20AC",	name: "euro", 	currency: "EUR"},
	{	symbol: "£", unicode: "x00A3",	name: "pound", 	currency: "GBP"},
	{	symbol: "¥", unicode: "x00A5",	name: "yen", 	currency: "JPY"},
	{	symbol: "₹", unicode: "x20B9",	name: "rupee", 	currency: "INR"}	
];


// Modify mathjs internal functions to allow for use of currency symbols
const currencySymbols: string[] = defaultCurrencyMap.map(m => m.symbol);
const isAlphaOriginal = math.parse.isAlpha;
math.parse.isAlpha = function (c, cPrev, cNext) {
	return isAlphaOriginal(c, cPrev, cNext) || currencySymbols.includes(c)
	};	

// 														@ts-ignore
const isUnitAlphaOriginal = math.Unit.isValidAlpha; // 	@ts-ignore
math.Unit.isValidAlpha =
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function (c: string, cPrev: any, cNext: any) {
	return isUnitAlphaOriginal(c, cPrev, cNext) || currencySymbols.includes(c)
	};			


// TODO: see if would be faster to return a single set of RegEx to get executed, rather than re-computing regex each time
function texCurrencyReplacement(input_tex:string) {
	for (const symbolType of defaultCurrencyMap) {
		input_tex = input_tex.replace(RegExp("\\\\*\\"+symbolType.symbol,'g'),"\\" + symbolType.name);
	}
	return input_tex
}



/**
 * Converts a string of HTML into a DocumentFragment continaing a sanitized collection array of DOM elements.
 *
 * @param html The HTML string to convert.
 * @returns A DocumentFragment contaning DOM elements.
 */
export function htmlToElements(html: string): DocumentFragment {
	const sanitizedHTML = sanitizeHTMLToDom(html);
	return sanitizedHTML;
  }

async function mathjaxLoop(container: HTMLElement, value: string) {
	const html = renderMath(value, true);
	await finishRenderMath()

	// container.empty();
	container.append(html);
}

/**
 * Return a function that formats a number according to the given locale
 * @param locale Locale to use
 * @returns Function that calls toLocaleString with given locale
 */
function getLocaleFormatter(locale: Intl.LocalesArgument|null = null): (value: number) => string {
	if (locale === null) {
		return (value: number): string => value.toLocaleString();
	} else {
		return (value: number): string => value.toLocaleString(locale);
	}
}
	
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type mathjsFormat = number | math.FormatOptions | ((item: any) => string) | undefined;
/**
 * Map Numerals Number Format to mathjs format options
 * @param format Numerals Number Format
 * @returns mathjs format object
 * @see https://mathjs.org/docs/reference/functions/format.html
 */
function getMathjsFormat(format: NumeralsNumberFormat): mathjsFormat {
	switch (format) {
		case NumeralsNumberFormat.System:
			return getLocaleFormatter();			
		case NumeralsNumberFormat.Fixed:
			return {notation: "fixed"};
		case NumeralsNumberFormat.Exponential:
			return {notation: "exponential"};
		case NumeralsNumberFormat.Engineering:
			return {notation: "engineering"};
		case NumeralsNumberFormat.Format_CommaThousands_PeriodDecimal:
			return getLocaleFormatter('en-US');
		case NumeralsNumberFormat.Format_PeriodThousands_CommaDecimal:
			return getLocaleFormatter('de-DE');
		case NumeralsNumberFormat.Format_SpaceThousands_CommaDecimal:
			return getLocaleFormatter('fr-FR');
		case NumeralsNumberFormat.Format_Indian:
			return getLocaleFormatter('en-IN');
		default:
			return {notation: "fixed"};
	}
}

export default class NumeralsPlugin extends Plugin {
	settings: NumeralsSettings;
	private currencyMap: CurrencyType[] = defaultCurrencyMap;
	private preProcessors: StringReplaceMap[];
	private currencyPreProcessors: StringReplaceMap[];
	private numberFormat: mathjsFormat;

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
			if (rawRows[i].match(/^[^#\r\n]*=>.*$/)) {				 								
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
		processedSource = processedSource.replace(/^([^#\r\n]*)(=>[\t ]*)(.*)$/gm,"$1$3") 
			
		for (const processor of this.preProcessors ) {
			processedSource = processedSource.replace(processor.regex, processor.replaceStr)
		}
		
		// Process input through mathjs

		let errorMsg = null;
		let errorInput = '';

		const rows: string[] = processedSource.split("\n");
		const results: string[] = [];
		const inputs: string[] = [];			
		// eslint-disable-next-line prefer-const
		let scope:Map<string, unknown> = new Map<string, unknown>();

		// Add numeric frontmatter to scope
		if (ctx.frontmatter) {
			// TODO add option to process all frontmatter keys
			scope = processFrontmatter(ctx.frontmatter, scope, this.settings.forceProcessAllFrontmatter);
		}
				
		for (const row of rows.slice(0,-1)) { // Last row may be empty
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
			if (this.settings.hideEmitterMarkupInInput) {
				rawRows[i] = rawRows[i].replace(/^([^#\r\n]*)(=>[\t ]*)(.*)$/gm,"$1$3") 
			}
	
			let inputElement: HTMLElement, resultElement: HTMLElement;
			switch(blockRenderStyle) {
				case NumeralsRenderStyle.Plain: {
					const rawInputSansComment = rawRows[i].replace(/#.+$/, "")
					const inputText = emptyLine ? rawRows[i] : rawInputSansComment;
					inputElement = line.createEl("span", { text: inputText, cls: "numerals-input"});
					
					const formattedResult = !emptyLine ? this.settings.resultSeparator + math.format(results[i], this.numberFormat) : '\xa0';
					resultElement = line.createEl("span", { text: formattedResult, cls: "numerals-result" });

					break;
				} case NumeralsRenderStyle.TeX: {
					const inputText = emptyLine ? rawRows[i] : ""; // show comments from raw text if no other input
					inputElement = line.createEl("span", {text: inputText, cls: "numerals-input"});
					const resultContent = !emptyLine ? "" : '\xa0';
					resultElement = line.createEl("span", { text: resultContent, cls: "numerals-result" });
					if (!emptyLine) {
						// Input to Tex
						const preprocess_input_tex:string = math.parse(inputs[i]).toTex();
						let input_tex:string = unescapeSubscripts(preprocess_input_tex);
						// log the text string and the input to consol
						// console.log(`inputs[i]: ${inputs[i]} | preprocess_input_tex: ${preprocess_input_tex} | input_tex: ${input_tex}`)
						
						const inputTexElement = inputElement.createEl("span", {cls: "numerals-tex"})

						input_tex = texCurrencyReplacement(input_tex);
						mathjaxLoop(inputTexElement, input_tex);

						// Result to Tex
						const resultTexElement = resultElement.createEl("span", {cls: "numerals-tex"})

						// format result to string to get reasonable precision. Commas will be stripped
						let processedResult:string = math.format(results[i], getLocaleFormatter('posix'));
						for (const processor of this.preProcessors ) {
							processedResult = processedResult.replace(processor.regex, processor.replaceStr)
						}
						let texResult = math.parse(processedResult).toTex() // TODO: Add custom handler for numbers to get good localeString formatting
						texResult = texCurrencyReplacement(texResult);
						mathjaxLoop(resultTexElement, texResult);
					}
					break;
				} case NumeralsRenderStyle.SyntaxHighlight: {
					const inputText = emptyLine ? rawRows[i] : ""; // show comments from raw text if no other input
					inputElement = line.createEl("span", {text: inputText, cls: "numerals-input"});
					if (!emptyLine) {
						const input_elements:DocumentFragment = htmlToElements(math.parse(inputs[i]).toHTML())
						inputElement.appendChild(input_elements);
					}

					const formattedResult = !emptyLine ? this.settings.resultSeparator + math.format(results[i], this.numberFormat) : '\xa0';
					resultElement = line.createEl("span", { text: formattedResult, cls: "numerals-result" });

					break;
				}
			}
	
			if (!emptyLine) {
				const inlineComment = rawRows[i].match(/#.+$/);
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
			line.createEl("span", { text: errorInput, cls: "numerals-input"});
			const resultElement = line.createEl("span", {cls: "numerals-result" });
			resultElement.createEl("span", {cls:"numerals-error-name", text: errorMsg.name + ":"});
			resultElement.createEl("span", {cls:"numerals-error-message", text: errorMsg.message});		
		}
	
	}

	private createCurrencyMap(dollarCurrency: string, yenCurrency: string): CurrencyType[] {
		const currencyMap: CurrencyType[] = defaultCurrencyMap.map(m => {
			if (m.symbol === "$") {
				if (Object.keys(currencyCodesForDollarSign).includes(dollarCurrency)) {
					m.currency = dollarCurrency;
				}
			} else if (m.symbol === "¥") {
				if (Object.keys(currencyCodesForYenSign).includes(yenCurrency)) {
					m.currency = yenCurrency;
				}
			}
			return m;
		})
		return currencyMap;
	}

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

		// // DEBUGGING PURPOSES ONLY: Add Development Commands
		// this.addCommand({
		// 	id: 'numerals-debug',
		// 	name: 'Run Numerals Dev Test',
		// 	callback: async () => {
		// 		// Developme Functions Here
		// 	}
		// });				

		// Load MathJax for TeX Rendering
		await loadMathJax();

		// this.currencyMap = this.createMoneyMap(this.settings.dollarCurrency, this.settings.yenCurrency);
		this.currencyMap = this.createCurrencyMap(
			this.settings.dollarSymbolCurrency.currency,
			this.settings.yenSymbolCurrency.currency
		);

		// Configure currency commands in MathJax
		const configureCurrencyStr = this.currencyMap.map(m => '\\def\\' + m.name + '{\\unicode{' + m.unicode + '}}').join('\n');
		renderMath(configureCurrencyStr, true);


		// TODO: Once mathjs support removing units (josdejong/mathjs#2081),
		//       rerun unit creation and regex preprocessors on settings change
		for (const moneyType of this.currencyMap) {
			math.createUnit(moneyType.currency, {aliases:[moneyType.currency.toLowerCase(), moneyType.symbol]});
		}
		
		this.currencyPreProcessors = this.currencyMap.map(m => {
			return {regex: RegExp('\\' + m.symbol + '([\\d\\.]+)','g'), replaceStr: '$1 ' + m.currency}
		})
		
		this.preProcessors = [
			// {regex: /\$((\d|\.|(,\d{3}))+)/g, replace: '$1 USD'}, // Use this if commas haven't been removed already
			{regex: /,(\d{3})/g, replaceStr: '$1'}, // remove thousands seperators. Will be wrong for add(100,100)
			...this.currencyPreProcessors
		];
		
		// Register Markdown Code Block Processors and pass in the render style
		this.registerMarkdownCodeBlockProcessor("math", this.numeralsMathBlockHandler.bind(this, null));
		this.registerMarkdownCodeBlockProcessor("Math", this.numeralsMathBlockHandler.bind(this, null));		
		this.registerMarkdownCodeBlockProcessor("math-plain", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.Plain));		
		this.registerMarkdownCodeBlockProcessor("math-tex", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX));
		this.registerMarkdownCodeBlockProcessor("math-TeX", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX));
		this.registerMarkdownCodeBlockProcessor("math-highlight", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.SyntaxHighlight));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new NumeralsSettingTab(this.app, this));

		// Register editor suggest handler
		if (this.settings.provideSuggestions) {
			this.registerEditorSuggest(new NumeralsSuggestor(this));
		}

		// Setup number formatting
		this.updateLocale();

	}

	async loadSettings() {

		const loadData = await this.loadData();
		if (loadData) {
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
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Update the locale used for formatting numbers. Takes no arguments and returnings nothing
	 * @returns {void}
	 */
	updateLocale(): void {
		this.numberFormat = getMathjsFormat(this.settings.numberFormat);
	}
}
