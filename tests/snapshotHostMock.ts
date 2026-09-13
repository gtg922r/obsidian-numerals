import { StateField, StateEffect } from '@codemirror/state';
import type { App, Editor, EventRef, MarkdownFileInfo, PluginManifest, TFile as ObsidianFile } from 'obsidian';
export class TFile { path = ''; }

export class Component {
 private cleanups: (() => void)[] = [];
 register(cleanup: () => void): void { this.cleanups.push(cleanup); }
 registerDomEvent(element: HTMLElement, event: string, callback: EventListener): void {
  element.addEventListener(event, callback); this.register(() => element.removeEventListener(event, callback));
 }
 onunload(): void {}
 unload(): void { this.onunload(); for (const cleanup of this.cleanups.splice(0).reverse()) cleanup(); }
}
export class MarkdownRenderChild extends Component { constructor(readonly containerEl: HTMLElement) { super(); } }
export class MarkdownView {
 file: ObsidianFile | null = null;
 editor!: Editor;
 containerEl = document.createElement('div');
 getViewData(): string { return this.editor.getValue(); }
}
export class Plugin extends Component {
 constructor(readonly app: App, readonly manifest: PluginManifest) { super(); }
 registerEvent(ref: EventRef): void {
  this.register(() => { this.app.metadataCache.offref(ref); this.app.vault.offref(ref); this.app.workspace.offref(ref); });
 }
 registerMarkdownCodeBlockProcessor = jest.fn(); registerMarkdownPostProcessor = jest.fn();
 registerEditorExtension = jest.fn(); registerEditorSuggest = jest.fn(); addSettingTab = jest.fn(); addCommand = jest.fn();
 loadData = jest.fn().mockResolvedValue(undefined); saveData = jest.fn().mockResolvedValue(undefined);
}
export class PluginSettingTab {}
export class Modal {}
export const Notice = jest.fn();
export const loadMathJax = jest.fn().mockResolvedValue(undefined);
export const renderMath = jest.fn((text: string) => { const element = document.createElement('span'); element.textContent = text; return element; });
export const finishRenderMath = jest.fn().mockResolvedValue(undefined);
export const sanitizeHTMLToDom = (html: string) => { const template = document.createElement('template'); template.innerHTML = html; return template.content; };
export const parseYaml = jest.requireActual<{load(text: string): unknown}>('js-yaml').load;
export const editorInfoField = StateField.define<MarkdownFileInfo | undefined>({create: () => undefined, update: value => value});
export const setLivePreview = StateEffect.define<boolean>();
export const editorLivePreviewField = StateField.define<boolean>({create: () => false, update: (value, transaction) => {
 for (const effect of transaction.effects) if (effect.is(setLivePreview)) value = effect.value;
 return value;
}});
