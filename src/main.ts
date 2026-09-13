import { NumeralsSuggestor } from "./NumeralsSuggestor";
import { defaultCurrencyMap } from "./rendering/displayUtils";
import {
	createNumberFormatProfile,
	createResultFormatter,
	CurrencyRegistry,
	ResultFormatter,
} from "./formatting";
import { processAndRenderNumeralsBlockFromSource } from "./rendering/orchestrator";
import { handleNumeralsBlockClick } from "./rendering/editorNavigation";
import { getMetadataForFileAtPath, addGlobalsFromScopeToPageCache } from "./processing/scope";
import { createInlineNumeralsPostProcessor, createInlineLivePreviewExtension } from "./inline";
import {
	CurrencyType,
	CurrencyDisplayMode,
	CurrencyPrecisionMode,
	NumeralsLayout,
	NumeralsRenderStyle,
	NumeralsSettings,
	DEFAULT_SETTINGS,
	NumeralsScope,
	StringReplaceMap,
	normalizeCurrencyFormattingSettings,
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
} from "obsidian";
import { getDataviewApi } from './dataview';

import * as math from 'mathjs';


// Modify mathjs internal functions to allow for use of currency symbols
const currencySymbols: string[] = defaultCurrencyMap.map(m => m.symbol);
const isAlphaOriginal = math.parse.isAlpha.bind(math.parse);
math.parse.isAlpha = function (c: string, cPrev: string, cNext: string) {
	return isAlphaOriginal(c, cPrev, cNext) || currencySymbols.includes(c)
};

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment,
   @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call,
   @typescript-eslint/no-unsafe-return -- mathjs internal API not typed */
const isUnitAlphaOriginal = (math.Unit as any).isValidAlpha;
(math.Unit as any).isValidAlpha =
function (c: string) {
	return isUnitAlphaOriginal(c) || currencySymbols.includes(c)
};
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment,
   @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call,
   @typescript-eslint/no-unsafe-return */

export default class NumeralsPlugin extends Plugin {
	settings!: NumeralsSettings;
	private currencyMap: CurrencyType[] = defaultCurrencyMap;
	private preProcessors: StringReplaceMap[] = [];
	private currencyRegistry = CurrencyRegistry.create([]);
	private resultFormatter: ResultFormatter = createResultFormatter({
		profile: createNumberFormatProfile(DEFAULT_SETTINGS.numberFormat),
	});
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

		let blockResult = processAndRenderNumeralsBlockFromSource(
			el,
			source,
			ctx,
			metadata,
			type,
			this.settings,
			this.resultFormatter,
			this.preProcessors,
			this.app
		);

		addGlobalsFromScopeToPageCache(ctx.sourcePath, blockResult.scope, this.scopeCache);

		// Track paths of cross-note referenced files for re-render detection
		let referencedPaths = blockResult.referencedPaths;

		// TS-1 Fix: Register events on the MarkdownRenderChild, not on the Plugin.
		// This ensures listeners are cleaned up when the render child is unloaded
		// (e.g., when navigating away), preventing unbounded listener accumulation.
		const numeralsBlockChild = new MarkdownRenderChild(el);

		const numeralsBlockCallback = (_callbackType: unknown, file: unknown, _oldPath?: unknown) => {
			// Check if the changed file is a cross-note referenced file
			const changedPath = (file && typeof file === 'object' && 'path' in file)
				? (file as { path: string }).path
				: undefined;
			const isReferencedFileChange = changedPath && referencedPaths.includes(changedPath);

			const currentMetadata = getMetadataForFileAtPath(ctx.sourcePath, this.app, this.scopeCache);
			if (!isReferencedFileChange && equal(currentMetadata, metadata)) {
				return;
			}
			metadata = currentMetadata;

			el.empty();

			blockResult = processAndRenderNumeralsBlockFromSource(
				el,
				source,
				ctx,
				metadata,
				type,
				this.settings,
				this.resultFormatter,
				this.preProcessors,
				this.app
			);

			addGlobalsFromScopeToPageCache(ctx.sourcePath, blockResult.scope, this.scopeCache);
			referencedPaths = blockResult.referencedPaths;
		};

		const dataviewAPI = getDataviewApi(this.app);
		if (dataviewAPI) {
			// Register on the child component so it auto-cleans on unload
			const ref = this.app.metadataCache.on(
				// @ts-expect-error: dataview custom event not in Obsidian types
				"dataview:metadata-change",
				numeralsBlockCallback
			);
			numeralsBlockChild.registerEvent(ref);
		} else {
			const ref = this.app.metadataCache.on("changed", numeralsBlockCallback);
			numeralsBlockChild.registerEvent(ref);
		}

		numeralsBlockChild.registerDomEvent(el, "click", (event: MouseEvent) => {
			handleNumeralsBlockClick(event, ctx, el, this.app);
		});

		ctx.addChild(numeralsBlockChild);
	}

	private createCurrencyMap(
			dollarCurrency: string,
			yenCurrency: string,
			customCurrency: CurrencyType | null
		): CurrencyType[] {
		let currencyMap: CurrencyType[] = defaultCurrencyMap.map(m => {
			const currency = { ...m };
			if (m.symbol === "$") {
				if (Object.keys(currencyCodesForDollarSign).includes(dollarCurrency)) {
					currency.currency = dollarCurrency;
				}
			} else if (m.symbol === "¥") {
				if (Object.keys(currencyCodesForYenSign).includes(yenCurrency)) {
					currency.currency = yenCurrency;
				}
			}
			return currency;
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
		this.updateFormatting();
	}

	private updatePreProcessors() {
		const currencyPreProcessors = this.currencyMap.map(m => {
			return {currencySymbol: m.symbol, currencyCode: m.currency, regex: RegExp('\\' + m.symbol + '([\\d\\.]+)','g'), replaceStr: '$1 ' + m.currency}
		});

		this.preProcessors = [
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
		this.updateFormatting();

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
				() => this.resultFormatter,
				() => this.preProcessors,
				this.scopeCache
			)
		);

		// Register inline Numerals CM6 extension (Live Preview mode)
		this.registerEditorExtension(
			createInlineLivePreviewExtension(
				() => this.settings,
				() => this.resultFormatter,
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
		const loadData = await this.loadData() as Partial<NumeralsSettings> & Record<string, unknown> | undefined;
		let shouldSaveSettings = false;
		if (loadData) {
			if (normalizeCurrencyFormattingSettings(loadData)) {
				console.warn('Numerals: Repaired invalid currency formatting settings');
				shouldSaveSettings = true;
			}

			// Check for signature of old setting format, then port to new setting format
			if (loadData.layoutStyle == undefined) {
				const oldRenderStyleMap: Record<number, NumeralsLayout> = {
					1: NumeralsLayout.TwoPanes,
					2: NumeralsLayout.AnswerRight,
					3: NumeralsLayout.AnswerBelow
				};

				loadData.layoutStyle = oldRenderStyleMap[loadData['renderStyle'] as number];
				if (loadData.layoutStyle) {
					delete loadData['renderStyle'];
					shouldSaveSettings = true;
				} else {
					console.warn("Numerals: Error porting old layout style");
				}

			} else if ([0, 1, 2, 3].includes(loadData.layoutStyle as unknown as number)) {
				// BP-1 Fix: was `in [0,1,2,3]` which checks array indices, not values
				const oldLayoutStyleMap: Record<number, NumeralsLayout> = {
					0: NumeralsLayout.TwoPanes,
					1: NumeralsLayout.AnswerRight,
					2: NumeralsLayout.AnswerBelow,
					3: NumeralsLayout.AnswerInline,
				};

				loadData.layoutStyle = oldLayoutStyleMap[loadData.layoutStyle as unknown as number];
				if (loadData.layoutStyle) {
					shouldSaveSettings = true;
				} else {
					console.warn("Numerals: Error porting old layout style");
				}
			}
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadData);
		if (shouldSaveSettings) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updateLocale(): void {
		this.updateFormatting();
	}

	updateFormatting(): void {
		const customCurrencyCode = this.settings.customCurrencySymbol?.currency.trim();
		const fractionDigitsByCode = customCurrencyCode
			? new Map([[customCurrencyCode, this.settings.customCurrencyDecimalPlaces]])
			: undefined;
		this.currencyRegistry = CurrencyRegistry.create(this.currencyMap, {
			fractionDigitsByCode,
		});
		this.resultFormatter = createResultFormatter({
			profile: createNumberFormatProfile(this.settings.numberFormat),
			currencies: this.currencyRegistry,
			preProcessors: this.preProcessors,
			currencyPrecisionMode: this.settings.currencyPrecisionMode ??
				CurrencyPrecisionMode.CurrencyStandard,
			currencyDisplayMode: this.settings.currencyDisplayMode ??
				CurrencyDisplayMode.Code,
		});
	}
}
