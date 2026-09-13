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
import { HostEventHub } from './host/events';
import { BlockOccurrence } from './host/occurrence';
import {
	Plugin,
	Notice,
	loadMathJax,
	MarkdownPostProcessorContext,
} from "obsidian";

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

	private hostEvents!: HostEventHub;
	private blockOccurrences = new WeakMap<HTMLElement, BlockOccurrence>();
	private activeBlocks = new Set<BlockOccurrence>();
	private disposeInline: (() => void) | undefined;

	async numeralsMathBlockHandler(
		type: NumeralsRenderStyle | undefined, source: string, el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		const render = (context: MarkdownPostProcessorContext) => {
			el.empty();
			const metadata = getMetadataForFileAtPath(context.sourcePath, this.app, this.scopeCache);
			const result = processAndRenderNumeralsBlockFromSource(el, source, context, metadata, type,
				this.settings, this.resultFormatter, this.preProcessors, this.app);
			addGlobalsFromScopeToPageCache(context.sourcePath, result.scope, this.scopeCache);
			return result;
		};
		const sourceKey = `${type ?? ""}\0${source.replace(/\n$/, "")}`;
		const clickListener = (event: MouseEvent) => handleNumeralsBlockClick(event, occurrence.getContext(), el, this.app);
		const existing = this.blockOccurrences.get(el);
		if (existing && !existing.isDisposed && existing.ownedBy(ctx)) {
			existing.refresh(ctx, render, sourceKey);
			return;
		}
		existing?.dispose();
		const occurrence = new BlockOccurrence(el, ctx, render, sourceKey, this.hostEvents, () => {
			el.removeEventListener("click", clickListener);
			this.activeBlocks.delete(occurrence);
			if (this.blockOccurrences.get(el) === occurrence) this.blockOccurrences.delete(el);
		});
		this.blockOccurrences.set(el, occurrence);
		this.activeBlocks.add(occurrence);
		occurrence.registerDomEvent(el, 'click', clickListener);
		ctx.addChild(occurrence);
		occurrence.renderNow();
	}

	async onload() {
		const generation = ++this.loadGeneration;
		await this.loadSettings(generation);
		if (generation !== this.loadGeneration) return;
		const controller = this.settingsController;
		this.register(() => controller.dispose());
		const hostEvents = new HostEventHub(this.app, listener => this.subscribeSettingsChanges(listener));
		this.hostEvents = hostEvents;
		this.register(() => hostEvents.dispose());
		this.register(this.hostEvents.subscribe(event => {
			if (event.kind !== 'settings' || event.change.effects.has('evaluation')) this.scopeCache.clear();
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
		const inlineProcessor = createInlineNumeralsPostProcessor(this.app, () => this.settings,
			() => this.resultFormatter, () => this.preProcessors, this.scopeCache, this.hostEvents);
		this.disposeInline = () => inlineProcessor.dispose();
		this.register(this.disposeInline);
		this.registerMarkdownPostProcessor(inlineProcessor);

		// Register inline Numerals CM6 extension (Live Preview mode)
		this.registerEditorExtension(
			createInlineLivePreviewExtension(
				() => this.settings,
				() => this.resultFormatter,
				() => this.preProcessors,
				this.scopeCache,
				this.app,
				this.hostEvents
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
		for (const occurrence of [...this.activeBlocks]) occurrence.dispose();
		this.disposeInline?.();
		this.hostEvents?.dispose();
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
