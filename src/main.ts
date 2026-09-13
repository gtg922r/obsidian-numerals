import { NumeralsSuggestor } from './NumeralsSuggestor';
import { createInlineNumeralsPostProcessor, createInlineLivePreviewExtension } from './inline';
import { type NumeralsSettings, NumeralsRenderStyle } from './numerals.types';
import { NumeralsSettingTab } from './settings';
import { createCurrencyPreProcessors } from './settings/currencies';
import { type SettingsChange, SettingsController } from './settings/changes';
import { type NumeralsRuntimeContext, NumeralsSettingsRuntime } from './settings/runtimeState';
import { HostEventHub } from './host/events';
import { SnapshotCoordinator } from './host/snapshotCoordinator';
import { SourceRegistry } from './host/sourceRegistry';
import { BlockSurface } from './host/blockSurface';
import { captureHostInputs } from './host/captureInputs';
import { Plugin, Notice, loadMathJax, type MarkdownPostProcessorContext, type Editor, TFile } from 'obsidian';

export default class NumeralsPlugin extends Plugin {
 private loadGeneration = 0;
 private settingsController!: SettingsController;
 private settingsRuntime!: NumeralsSettingsRuntime;
 declare settings: NumeralsSettings;
 private sources!: SourceRegistry;
 private readonly blocks = new WeakMap<HTMLElement, BlockSurface>();
 private readonly activeBlocks = new Set<BlockSurface>();
 get configurationError(): string | undefined { return this.settingsRuntime.configurationError; }
 get currencyWarnings(): readonly string[] { return this.getRuntimeContext().currencyWarnings; }
 get settingsGeneration(): number { return this.settingsController.settingsGeneration; }
 get evaluationSettingsGeneration(): number { return this.settingsController.evaluationSettingsGeneration; }
 getRuntimeContext(): NumeralsRuntimeContext { return this.settingsRuntime.context; }
 subscribeSettingsChanges(listener: (change: SettingsChange) => void): () => void { return this.settingsController.subscribe(listener); }

 /** H/suggestion seam: exact provided editor, indexed current data, never scopes or a path-selected sibling. */
 getEditorSnapshot(editor: Editor) {
  const source = this.sources?.fromEditor(editor);
  return source && this.sources.coordinator.current(source.identity);
 }
 subscribeEditorSnapshot(editor: Editor, listener: () => void): () => void {
  const source = this.sources?.fromEditor(editor);
  return source ? this.sources.coordinator.subscribe(source.identity, listener) : () => {};
 }

 async numeralsMathBlockHandler(type: NumeralsRenderStyle | undefined, source: string, el: HTMLElement,
  ctx: MarkdownPostProcessorContext): Promise<void> {
  const existing = this.blocks.get(el);
  if (existing?.context === ctx) { existing.refresh(source, type); return; }
  existing?.dispose();
  const surface = new BlockSurface(el, ctx, source, type, this.sources, this.app, () => {
   this.activeBlocks.delete(surface);
   if (this.blocks.get(el) === surface) this.blocks.delete(el);
  });
  this.blocks.set(el, surface); this.activeBlocks.add(surface); ctx.addChild(surface); surface.refresh();
 }

 async onload(): Promise<void> {
  const generation = ++this.loadGeneration;
  await this.loadSettings(generation);
  if (generation !== this.loadGeneration) return;
  const controller = this.settingsController;
  this.register(() => controller.dispose());
  // Configuration repair remains available even when MathJax cannot load.
  this.addSettingTab(new NumeralsSettingTab(this.app, this));
  if (this.configurationError) new Notice(this.configurationError);
  const coordinator = new SnapshotCoordinator({configuration: () => ({settings: this.settings,
   runtime: this.getRuntimeContext(), settingsGeneration: this.settingsGeneration,
   evaluationSettingsGeneration: this.evaluationSettingsGeneration}),
   capture: (index, configuration, signal, isCurrent) => captureHostInputs(this.app, index, configuration, signal, isCurrent)});
  const sources = new SourceRegistry(this.app, coordinator); this.sources = sources;
  this.register(() => { for (const block of [...this.activeBlocks]) block.dispose(); sources.dispose(); coordinator.dispose(); });
  const events = new HostEventHub(this.app, listener => this.subscribeSettingsChanges(listener));
  this.register(() => events.dispose());
  this.register(events.subscribe(event => {
   if (event.kind === 'unload') return;
   if (event.kind === 'settings') { coordinator.settingsChanged(event.change.effects.has('evaluation')); return; }
   if (event.kind === 'ready') { coordinator.inputsChanged(); return; }
   if (event.kind === 'rename') coordinator.inputsChanged({kind: 'rename', path: event.newPath, oldPath: event.oldPath});
   else for (const path of event.paths) coordinator.inputsChanged({kind: event.kind === 'dataview' ? 'metadata' : event.kind, path});
  }));
  this.registerEvent(this.app.workspace.on('layout-change', () => sources.reconcile()));
  this.registerEvent(this.app.workspace.on('file-open', () => sources.reconcile()));
  this.registerEvent(this.app.workspace.on('editor-change', editor => {
   // Stop obsolete scheduled math synchronously. Classification waits for the CM
   // transaction's positive DOM witness; public editor-change never renews insertion.
   sources.invalidateEditor(editor);
   void Promise.resolve().then(() => { if (generation === this.loadGeneration) { sources.reconcile(); sources.sourceChanged(editor, false); } });
  }));
  this.registerEvent(this.app.vault.on('modify', file => {
   if (file instanceof TFile) sources.fileChanged(file);
   coordinator.inputsChanged({kind: 'metadata', path: file.path});
  }));
  this.registerEvent(this.app.vault.on('rename', file => { if (file instanceof TFile) sources.fileChanged(file); sources.reconcile(); }));
  this.registerEvent(this.app.vault.on('delete', () => sources.reconcile()));
  this.app.workspace.onLayoutReady(() => sources.reconcile());
  this.registerEditorExtension(createInlineLivePreviewExtension(sources));
  const inline = createInlineNumeralsPostProcessor(sources, () => this.settings);
  this.register(() => inline.dispose()); this.registerMarkdownPostProcessor(inline);
  const processors: [string, NumeralsRenderStyle | undefined][] = [['math', undefined], ['Math', undefined],
   ['math-plain', NumeralsRenderStyle.Plain], ['math-tex', NumeralsRenderStyle.TeX], ['math-TeX', NumeralsRenderStyle.TeX],
   ['math-highlight', NumeralsRenderStyle.SyntaxHighlight]];
  for (const [language, style] of processors) this.registerMarkdownCodeBlockProcessor(language,
   this.numeralsMathBlockHandler.bind(this, style), 100);
  this.addCommand({id: 'update-stored-results', name: 'Update stored results', editorCheckCallback: (checking, editor) => {
   const source = sources.fromEditor(editor);
   if (!source) return false;
   return checking ? coordinator.canInsert(source.identity) : coordinator.insert(source.identity, true);
  }});
  if (this.settings.provideSuggestions) this.registerEditorSuggest(new NumeralsSuggestor(this));
  try { await loadMathJax(); }
  catch (error: unknown) { if (generation === this.loadGeneration) new Notice(`Numerals could not load MathJax: ${error instanceof Error ? error.message : String(error)}. Settings remain available.`); }
 }

 onunload(): void { this.loadGeneration++; }

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
