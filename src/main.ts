import { NumeralsSuggestor } from "./NumeralsSuggestor";
import {
	defaultCurrencyMap,
	processAndRenderNumeralsBlockFromSource,
	getLocaleFormatter,
	getMetadataForFileAtPath,
	addGlobalsFromScopeToPageCache,
} from "./numeralsUtilities";
import {
	ensureCurrencyUnits,
	setupMathjsCurrencySupport,
	teardownMathjsCurrencySupport,
} from "./mathjsIntegration";
import {
	CurrencyType,
	NumeralsLayout,
	NumeralsRenderStyle,
	NumeralsNumberFormat,
	NumeralsSettings,
	mathjsFormat,
	DEFAULT_SETTINGS,
	NumeralsScope,
	StringReplaceMap,
} from "./numerals.types";	
import { 
	NumeralsSettingTab,
	currencyCodesForDollarSign,
	currencyCodesForYenSign,
 } from "./settings";
import equal from 'fast-deep-equal';
import {
	Plugin,
	renderMath,
	loadMathJax,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	TFile,
} from "obsidian";

import { getAPI } from 'obsidian-dataview';

// if use syntax tree directly will need "@codemirror/language": "^6.3.2", // Needed for accessing syntax tree
// import {syntaxTree, tokenClassNodeProp} from '@codemirror/language';

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
	settings!: NumeralsSettings;
	private currencyMap: CurrencyType[] = defaultCurrencyMap;
	private preProcessors: StringReplaceMap[] = [];
	private currencyPreProcessors: StringReplaceMap[] = [];
	private numberFormat: mathjsFormat = getLocaleFormatter();
	public scopeCache: Map<string, NumeralsScope> = new Map<string, NumeralsScope>();
	private suggestor: NumeralsSuggestor | null = null;
	private renderedBlockSignatures: WeakMap<HTMLElement, string> = new WeakMap();

	private normalizeBlockSource(source: string): string {
		return source.replace(/(?:\r?\n)+$/g, "");
	}

	private getBlockRenderSignature(
		type: NumeralsRenderStyle | null,
		source: string,
		sourcePath: string
	): string {
		return [
			sourcePath,
			type ?? this.settings.defaultRenderStyle,
			this.normalizeBlockSource(source),
		].join("::");
	}

	private isMetadataEventForSourcePath(
		args: unknown[],
		sourcePath: string
	): boolean {
		const normalizedPaths = args
			.filter((arg): arg is TFile | string => arg instanceof TFile || typeof arg === "string")
			.map((arg) => (arg instanceof TFile ? arg.path : arg));

		// Some metadata events do not provide a file path. In that case, re-check metadata hash below.
		if (normalizedPaths.length === 0) {
			return true;
		}
		return normalizedPaths.includes(sourcePath);
	}

	private ensureSuggestorRegistered(): void {
		if (this.suggestor) {
			return;
		}
		this.suggestor = new NumeralsSuggestor(this);
		this.registerEditorSuggest(this.suggestor);
	}

	async numeralsMathBlockHandler(type: NumeralsRenderStyle | null, source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {		
		const renderSignature = this.getBlockRenderSignature(type, source, ctx.sourcePath);
		if (this.renderedBlockSignatures.get(el) === renderSignature) {
			return;
		}
		this.renderedBlockSignatures.set(el, renderSignature);

		let metadata = getMetadataForFileAtPath(ctx.sourcePath, this.app, this.scopeCache);
		
		const scope = processAndRenderNumeralsBlockFromSource(
			el, 
			source,
			ctx,
			metadata,
			type,
			this.settings,
			this.numberFormat,
			this.preProcessors,
			this.app
		);

		addGlobalsFromScopeToPageCache(ctx.sourcePath, scope, this.scopeCache);

		const numeralsBlockChild = new MarkdownRenderChild(el);

		const numeralsBlockCallback = (...callbackArgs: unknown[]) => {
			if (!this.isMetadataEventForSourcePath(callbackArgs, ctx.sourcePath)) {
				return;
			}

			const currentMetadata = getMetadataForFileAtPath(ctx.sourcePath, this.app, this.scopeCache);
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
				this.app
			);

			addGlobalsFromScopeToPageCache(ctx.sourcePath, scope, this.scopeCache);
		}

		const dataviewAPI = getAPI();
		if (dataviewAPI) {
			//@ts-expect-error: "No overload matches this call"
			numeralsBlockChild.registerEvent(this.app.metadataCache.on("dataview:metadata-change", numeralsBlockCallback));
		} else {
			numeralsBlockChild.registerEvent(this.app.metadataCache.on("changed", numeralsBlockCallback));
		}

		numeralsBlockChild.onunload = () => {
			this.renderedBlockSignatures.delete(el);
		}
		ctx.addChild(numeralsBlockChild);

	}

	private createCurrencyMap(
			dollarCurrency: string,
			yenCurrency: string,
			customCurrency: CurrencyType | null
		): CurrencyType[] {
		let currencyMap: CurrencyType[] = defaultCurrencyMap.map(m => {
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
		if (customCurrency && customCurrency.symbol != "" && customCurrency.currency != "") {
			const customCurrencyType: CurrencyType = {
				name: customCurrency.name,
				symbol: customCurrency.symbol,
				unicode: customCurrency.unicode,
				currency: customCurrency.currency,
			}
			// add custom currency to currency map if it doesn't already exist. if it does, replace it
			currencyMap = currencyMap.map(m => m.symbol === customCurrencyType.symbol ? customCurrencyType : m);
			if (!currencyMap.some(m => m.symbol === customCurrencyType.symbol)) {
				currencyMap.push(customCurrencyType);
			}					
		}
		return currencyMap;
	}

	updateCurrencyMap() {
		this.currencyMap = this.createCurrencyMap(
			this.settings.dollarSymbolCurrency.currency,
			this.settings.yenSymbolCurrency.currency,
			this.settings.customCurrencySymbol
		);
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

		this.updateCurrencyMap();

		// Configure currency commands in MathJax
		const configureCurrencyStr = this.currencyMap.map(m => '\\def\\' + m.name + '{\\unicode{' + m.unicode + '}}').join('\n');
		renderMath(configureCurrencyStr, true);


		// TODO: Once mathjs support removing units (josdejong/mathjs#2081),
		//       rerun unit creation and regex preprocessors on settings change
		setupMathjsCurrencySupport(this.currencyMap.map((currency) => currency.symbol));
		ensureCurrencyUnits(this.currencyMap);

		// TODO: Incorporate this in a setup function that can be called when settings change, which should reduce need for restart after change
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

		// Register exactly one suggestor instance and gate behavior by settings.
		this.ensureSuggestorRegistered();

		// Setup number formatting
		this.updateLocale();

	}

	onunload() {
		this.scopeCache.clear();
		this.suggestor?.close();
		this.suggestor = null;
		this.renderedBlockSignatures = new WeakMap();
		teardownMathjsCurrencySupport();
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

			} else if ([0, 1, 2, 3].includes(loadData.layoutStyle)) {
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
