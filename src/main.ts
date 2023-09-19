import { NumeralsSuggestor } from "./NumeralsSuggestor";
import {
	StringReplaceMap,
	defaultCurrencyMap,
	CurrencyType,
	processAndRenderNumeralsBlockFromSource,
	getLocaleFormatter,
	getMetadataForFileAtPath,
	NumeralsScope,
	maybeAddScopeToPageCache } from "./numeralsUtilities";
import equal from 'fast-deep-equal';
import {
	Plugin,
	renderMath,
	loadMathJax,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
} from "obsidian";

import { getAPI } from 'obsidian-dataview';

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

	
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type mathjsFormat = number | math.FormatOptions | ((item: any) => string) | undefined;
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
	private scopeCache: Map<string, NumeralsScope> = new Map<string, NumeralsScope>();

	async numeralsMathBlockHandler(type: NumeralsRenderStyle, source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {		
		// TODO: Rendering is getting called twice. Once without newline at the end of the code block and once with.
		//       This is causing the code block to be rendered twice. Need to figure out why and fix it.

		let metadata = getMetadataForFileAtPath(ctx.sourcePath);
		
		const scope = processAndRenderNumeralsBlockFromSource(
			el, 
			source,
			ctx,
			metadata,
			type,
			this.settings,
			this.numberFormat,
			this.preProcessors,
		);

		maybeAddScopeToPageCache(ctx.sourcePath, scope, this.scopeCache);

		const numeralsBlockChild = new MarkdownRenderChild(el);

		const numeralsBlockCallback = (_callbackType: unknown, _file: unknown, _oldPath?: unknown) => {
			const currentMetadata = getMetadataForFileAtPath(ctx.sourcePath);
			if (equal(currentMetadata, metadata)) {
				return;
			} else {
				metadata = currentMetadata;
			}

			el.empty();

			const scope = processAndRenderNumeralsBlockFromSource(
				el,
				source,
				ctx,
				metadata,
				type,
				this.settings,
				this.numberFormat,
				this.preProcessors,
			);

			maybeAddScopeToPageCache(ctx.sourcePath, scope, this.scopeCache);
		}

		const dataviewAPI = getAPI();
		if (dataviewAPI) {
			//@ts-expect-error: "No overload matches this call"
			this.registerEvent(this.app.metadataCache.on("dataview:metadata-change", numeralsBlockCallback));
		} else {
			this.registerEvent(this.app.metadataCache.on("changed", numeralsBlockCallback));
		}

		numeralsBlockChild.onunload = () => {
			this.app.metadataCache.off("changed", numeralsBlockCallback);
			this.app.metadataCache.off("dataview:metadata-change", numeralsBlockCallback);
		}
		ctx.addChild(numeralsBlockChild);

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


		// Load MathJax for TeX Rendering
		await loadMathJax();

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
		const priority = 100;
		this.registerMarkdownCodeBlockProcessor("math", this.numeralsMathBlockHandler.bind(this, null), priority);  
		this.registerMarkdownCodeBlockProcessor("Math", this.numeralsMathBlockHandler.bind(this, null), priority);		  
		this.registerMarkdownCodeBlockProcessor("math-plain", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.Plain), priority);		  
		this.registerMarkdownCodeBlockProcessor("math-tex", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX), priority);  
		this.registerMarkdownCodeBlockProcessor("math-TeX", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX), priority);  
		this.registerMarkdownCodeBlockProcessor("math-highlight", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.SyntaxHighlight), priority); 

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
