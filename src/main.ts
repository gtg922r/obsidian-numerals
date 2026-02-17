import { NumeralsSuggestor } from "./NumeralsSuggestor";
import { defaultCurrencyMap, getLocaleFormatter } from "./rendering/displayUtils";
import { processAndRenderNumeralsBlockFromSource } from "./rendering/orchestrator";
import { getMetadataForFileAtPath, addGlobalsFromScopeToPageCache } from "./processing/scope";
import { createInlineNumeralsPostProcessor, createInlineLivePreviewExtension } from "./inline";
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
	EventRef,
} from "obsidian";

import { getAPI } from 'obsidian-dataview';

import * as math from 'mathjs';


// Modify mathjs internal functions to allow for use of currency symbols
const currencySymbols: string[] = defaultCurrencyMap.map(m => m.symbol);
const isAlphaOriginal = math.parse.isAlpha;
math.parse.isAlpha = function (c, cPrev, cNext) {
	return isAlphaOriginal(c, cPrev, cNext) || currencySymbols.includes(c)
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mathjs internal API
const isUnitAlphaOriginal = (math.Unit as any).isValidAlpha;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mathjs internal API
(math.Unit as any).isValidAlpha =
function (c: string) {
	return isUnitAlphaOriginal(c) || currencySymbols.includes(c)
};


/**
 * Map Numerals Number Format to mathjs format options
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
	private preProcessors!: StringReplaceMap[];
	private numberFormat: mathjsFormat;
	public scopeCache: Map<string, NumeralsScope> = new Map<string, NumeralsScope>();

	/**
	 * Tracks rendered source strings to deduplicate the double-render issue.
	 * Obsidian calls the code block processor twice (with and without trailing newline).
	 * We use a WeakMap keyed by the container element to detect and skip duplicates.
	 */
	private renderedBlocks: WeakMap<HTMLElement, string> = new WeakMap();

	async numeralsMathBlockHandler(
		type: NumeralsRenderStyle | undefined,
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		// Fix double-rendering: Obsidian calls processors twice (with/without trailing newline).
		// Normalize source and skip if we've already rendered this block.
		const normalizedSource = source.replace(/\n$/, '');
		const parentEl = el.parentElement;
		if (parentEl) {
			const previousSource = this.renderedBlocks.get(parentEl);
			if (previousSource === normalizedSource) {
				el.remove();
				return;
			}
			this.renderedBlocks.set(parentEl, normalizedSource);
		}

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

		// TS-1 Fix: Register events on the MarkdownRenderChild, not on the Plugin.
		// This ensures listeners are cleaned up when the render child is unloaded
		// (e.g., when navigating away), preventing unbounded listener accumulation.
		const numeralsBlockChild = new MarkdownRenderChild(el);

		const numeralsBlockCallback = (_callbackType: unknown, _file: unknown, _oldPath?: unknown) => {
			const currentMetadata = getMetadataForFileAtPath(ctx.sourcePath, this.app, this.scopeCache);
			if (equal(currentMetadata, metadata)) {
				return;
			}
			metadata = currentMetadata;

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
		};

		const dataviewAPI = getAPI();
		if (dataviewAPI) {
			// Register on the child component so it auto-cleans on unload
			const ref = this.app.metadataCache.on(
				// @ts-expect-error: dataview custom event not in Obsidian types
				"dataview:metadata-change",
				numeralsBlockCallback
			) as EventRef;
			numeralsBlockChild.registerEvent(ref);
		} else {
			const ref = this.app.metadataCache.on("changed", numeralsBlockCallback);
			numeralsBlockChild.registerEvent(ref);
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
		});
		if (customCurrency && customCurrency.symbol != "" && customCurrency.currency != "") {
			const customCurrencyType: CurrencyType = {
				name: customCurrency.name,
				symbol: customCurrency.symbol,
				unicode: customCurrency.unicode,
				currency: customCurrency.currency,
			};
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
		this.updatePreProcessors();
	}

	private updatePreProcessors() {
		const currencyPreProcessors = this.currencyMap.map(m => {
			return {regex: RegExp('\\' + m.symbol + '([\\d\\.]+)','g'), replaceStr: '$1 ' + m.currency}
		});

		this.preProcessors = [
			{regex: /,(\d{3})/g, replaceStr: '$1'}, // remove thousands separators
			...currencyPreProcessors
		];
	}

	async onload() {
		await this.loadSettings();
		this.updateLocale();

		// Load MathJax for TeX Rendering
		await loadMathJax();

		this.updateCurrencyMap();

		// Configure currency commands in MathJax
		const configureCurrencyStr = this.currencyMap.map(m => '\\def\\' + m.name + '{\\unicode{' + m.unicode + '}}').join('\n');
		renderMath(configureCurrencyStr, true);

		// Create mathjs currency units (irreversible until mathjs supports unit removal)
		for (const moneyType of this.currencyMap) {
			if (moneyType.currency != '') {
				try {
					math.createUnit(moneyType.currency, {aliases:[moneyType.currency.toLowerCase(), moneyType.symbol]});
				} catch {
					// Unit already exists (e.g., plugin re-enabled without app restart)
				}
			}
		}

		// Register Markdown Code Block Processors
		const priority = 100;
		this.registerMarkdownCodeBlockProcessor("math", this.numeralsMathBlockHandler.bind(this, undefined), priority);
		this.registerMarkdownCodeBlockProcessor("Math", this.numeralsMathBlockHandler.bind(this, undefined), priority);
		this.registerMarkdownCodeBlockProcessor("math-plain", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.Plain), priority);
		this.registerMarkdownCodeBlockProcessor("math-tex", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX), priority);
		this.registerMarkdownCodeBlockProcessor("math-TeX", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.TeX), priority);
		this.registerMarkdownCodeBlockProcessor("math-highlight", this.numeralsMathBlockHandler.bind(this, NumeralsRenderStyle.SyntaxHighlight), priority);

		// Register inline Numerals post-processor (Reading mode)
		this.registerMarkdownPostProcessor(
			createInlineNumeralsPostProcessor(
				this.app,
				() => this.settings,
				() => this.numberFormat,
				() => this.preProcessors,
				this.scopeCache
			)
		);

		// Register inline Numerals CM6 extension (Live Preview mode)
		this.registerEditorExtension(
			createInlineLivePreviewExtension(
				() => this.settings,
				() => this.numberFormat,
				() => this.preProcessors,
				this.scopeCache,
				this.app
			)
		);

		this.addSettingTab(new NumeralsSettingTab(this.app, this));

		// Register editor suggest handler (only once on load, not on settings toggle)
		if (this.settings.provideSuggestions) {
			this.registerEditorSuggest(new NumeralsSuggestor(this));
		}
	}

	onunload() {
		this.scopeCache.clear();
	}

	async loadSettings() {
		const loadData = await this.loadData();
		if (loadData) {
			// Check for signature of old setting format, then port to new setting format
			if (loadData.layoutStyle == undefined) {
				const oldRenderStyleMap: Record<number, NumeralsLayout> = {
					1: NumeralsLayout.TwoPanes,
					2: NumeralsLayout.AnswerRight,
					3: NumeralsLayout.AnswerBelow
				};

				loadData.layoutStyle = oldRenderStyleMap[loadData.renderStyle as number];
				if (loadData.layoutStyle) {
					delete loadData.renderStyle;
					this.settings = loadData;
					this.saveSettings();
				} else {
					console.log("Numerals: Error porting old layout style");
				}

			} else if ([0, 1, 2, 3].includes(loadData.layoutStyle)) {
				// BP-1 Fix: was `in [0,1,2,3]` which checks array indices, not values
				const oldLayoutStyleMap: Record<number, NumeralsLayout> = {
					0: NumeralsLayout.TwoPanes,
					1: NumeralsLayout.AnswerRight,
					2: NumeralsLayout.AnswerBelow,
					3: NumeralsLayout.AnswerInline,
				};

				loadData.layoutStyle = oldLayoutStyleMap[loadData.layoutStyle as number];
				if (loadData.layoutStyle) {
					this.settings = loadData;
					this.saveSettings();
				} else {
					console.log("Numerals: Error porting old layout style");
				}
			}
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updateLocale(): void {
		this.numberFormat = getMathjsFormat(this.settings.numberFormat);
	}
}
