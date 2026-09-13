import { NumeralsSuggestor } from "./NumeralsSuggestor";
import { processAndRenderNumeralsBlockFromSource } from "./rendering/orchestrator";
import { handleNumeralsBlockClick } from "./rendering/editorNavigation";
import { getMetadataForFileAtPath, addGlobalsFromScopeToPageCache } from "./processing/scope";
import { createInlineNumeralsPostProcessor, createInlineLivePreviewExtension } from "./inline";
import {
	NumeralsRenderStyle,
	NumeralsSettings,
	NumeralsScope,
	StringReplaceMap,
} from "./numerals.types";
import { NumeralsSettingTab } from "./settings";
import { createCurrencyPreProcessors } from './settings/currencies';
import { SettingsChange, SettingsController } from './settings/changes';
import { NumeralsRuntimeContext, NumeralsSettingsRuntime } from './settings/runtimeState';
import equal from 'fast-deep-equal';
import {
	Plugin,
	Notice,
	loadMathJax,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
} from "obsidian";
import { getDataviewApi } from './dataview';

export default class NumeralsPlugin extends Plugin {
	private loadGeneration = 0;
	private settingsController!: SettingsController;
	private settingsRuntime!: NumeralsSettingsRuntime;

	declare settings: NumeralsSettings;
	get configurationError(): string | undefined { return this.settingsRuntime.configurationError; }
	get currencyWarnings(): readonly string[] { return this.getRuntimeContext().currencyWarnings; }
	get settingsGeneration(): number { return this.settingsController.settingsGeneration; }
	get evaluationSettingsGeneration(): number { return this.settingsController.evaluationSettingsGeneration; }
	getRuntimeContext(): NumeralsRuntimeContext { return this.settingsRuntime.context; }
	subscribeSettingsChanges(listener: (change: SettingsChange) => void): () => void {
		return this.settingsController.subscribe(listener);
	}
	private get preProcessors(): StringReplaceMap[] { return this.getRuntimeContext().preProcessors; }
	private get resultFormatter() { return this.getRuntimeContext().formatter; }
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

	async onload() {
		const generation = ++this.loadGeneration;
		await this.loadSettings(generation);
		if (generation !== this.loadGeneration) return;
		const controller = this.settingsController;
		this.register(() => controller.dispose());
		this.register(this.subscribeSettingsChanges(change => {
			if (change.effects.has('evaluation')) this.scopeCache.clear();
		}));
		if (this.configurationError) new Notice(this.configurationError);
		await loadMathJax();
		if (generation !== this.loadGeneration) return;

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
		this.loadGeneration++;
		this.scopeCache.clear();
		this.settingsController?.dispose();
	}

	private async loadSettings(generation: number): Promise<void> {
		const data: unknown = await this.loadData();
		if (generation !== this.loadGeneration) return;
		this.settingsController?.dispose();
		this.settingsRuntime = new NumeralsSettingsRuntime(createCurrencyPreProcessors);
		this.settingsController = new SettingsController(data, this.settingsRuntime, settings => this.saveData(settings));
		// Obsidian declares settings as a property; expose detached committed snapshots
		// while all native and programmatic writes use the explicit save hook.
		Object.defineProperty(this, 'settings', { configurable: true, get: () => this.settingsController.settings });
	}

	updateSettings(patch: Record<string, unknown>): Promise<void> {
		return this.settingsController.update(patch);
	}

	/** Programmatic callers use the same validated, serialized path as native controls. */
	saveSettings(patch: Partial<NumeralsSettings> = this.settings): Promise<void> {
		return this.updateSettings(patch);
	}
}
