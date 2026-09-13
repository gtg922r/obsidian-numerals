import { MarkdownView, TFile, type App, type Editor, type MarkdownFileInfo, type MarkdownPostProcessorContext } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { SnapshotCoordinator, type SourceOwner } from './snapshotCoordinator';

interface EditorAttachment { readonly view: MarkdownView; readonly editor: Editor; readonly file: TFile }
interface FileCapture { readonly file: TFile; text: string; ready: boolean; ticket: number; users: number; error?: string }
export interface SurfaceSource { readonly identity: object; readonly editor?: Editor; readonly path: string; readonly diagnostic?: string }

/** Optional context evidence observed in pinned host fixtures; never an editor capability. */
export function observedContextContainer(context: MarkdownPostProcessorContext): HTMLElement | undefined {
	const container = (context as MarkdownPostProcessorContext & {containerEl?: HTMLElement}).containerEl;
	const ElementType = container?.ownerDocument?.defaultView?.HTMLElement;
	return ElementType && container instanceof ElementType ? container : undefined;
}

/** Public host identity and complete-buffer proof. Paths never select an editor. */
export class SourceRegistry {
	private readonly editors = new Map<Editor, EditorAttachment>();
	private readonly files = new Map<TFile, FileCapture>();
	private readonly listeners = new Set<() => void>();
	private disposed = false;

	constructor(private readonly app: App, readonly coordinator: SnapshotCoordinator) {}
	get active(): boolean { return !this.disposed; }

	reconcile(): void {
		if (this.disposed) return;
		const present = new Set<Editor>();
		this.app.workspace.iterateAllLeaves(leaf => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const view = leaf.view, editor = view.editor, file = view.file;
			if (!file || !editor || !view.containerEl.isConnected || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
			present.add(editor);
			let attachment = this.editors.get(editor);
			// Temporary subview synchronization is not a new attachment cycle.
			if (editor.getValue() !== view.getViewData()) return;
			if (attachment?.file !== file || attachment.view !== view) {
				if (attachment) this.coordinator.detach(editor);
				attachment = {view, editor, file};
				this.editors.set(editor, attachment);
			}
			const owned = attachment;
			this.coordinator.attach({identity: editor, editor, text: () => editor.getValue(), file: () => view.file ?? undefined,
				attached: () => !this.disposed && this.editors.get(editor) === owned && view.editor === editor &&
					view.file === file && view.containerEl.isConnected && this.app.vault.getAbstractFileByPath(file.path) === file});
		});
		for (const editor of this.editors.keys()) {
			if (!present.has(editor)) { this.coordinator.detach(editor); this.editors.delete(editor); }
		}
		this.publish();
	}

	/** A cell/sub-editor sharing a path is insufficient: all three identities and full text must agree. */
	fromCodeMirror(view: EditorView, info: MarkdownFileInfo | undefined): SurfaceSource | undefined {
		if (this.disposed || !info?.editor || !info.file || view.dom.closest('.markdown-embed, .internal-embed')) return;
		const owner = this.editors.get(info.editor);
		if (!owner || owner.file !== info.file || owner.view.file !== owner.file ||
			!owner.view.containerEl.contains(view.dom) || owner.editor.getValue() !== view.state.doc.toString()) return;
		return {identity: owner.editor, editor: owner.editor, path: owner.file.path};
	}

	fromEditor(editor: Editor): SurfaceSource | undefined {
		if (this.disposed) return;
		const owner = this.editors.get(editor);
		if (!owner || owner.view.editor !== editor || owner.view.file !== owner.file || !owner.view.containerEl.isConnected ||
			this.app.vault.getAbstractFileByPath(owner.file.path) !== owner.file) return;
		return {identity: editor, editor, path: owner.file.path};
	}

	fromOccurrence(element: HTMLElement, context: MarkdownPostProcessorContext): SurfaceSource | undefined {
		if (this.disposed) return;
		const container = observedContextContainer(context);
		const embedded = Boolean(element.closest('.markdown-embed, .internal-embed') ||
			container?.closest('.markdown-embed, .internal-embed'));
		const owners = [...this.editors.values()].filter(owner => !embedded &&
			this.fromEditor(owner.editor) && owner.file.path === context.sourcePath);
		const contained = owners.filter(owner => owner.view.containerEl.contains(element));
		if (contained.length === 1) {
			const owner = contained[0];
			// A known editor remains the source during temporary subview mismatch.
			// Never evaluate its stale disk copy just because the view is catching up.
			return {identity: owner.editor, path: context.sourcePath,
				editor: owner.editor.getValue() === owner.view.getViewData() ? owner.editor : undefined};
		}
		// A detached callback can reuse existing mathematics only. Its connected
		// context and complete section text must prove the actual authoritative owner;
		// this neither attaches/rearms an editor nor grants navigation/write capability.
		if (!element.isConnected && container?.isConnected) {
			const section = context.getSectionInfo?.(element);
			const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
			const shared = owners.filter(owner => owner.view.containerEl.contains(container) &&
				owner.editor.getValue() === owner.view.getViewData() && this.coordinator.current(owner.editor) &&
				section && normalize(section.text) === normalize(owner.editor.getValue()));
			if (shared.length === 1) return {identity: shared[0].editor, path: context.sourcePath};
		}
		// Embeds and unknown origins use a complete target-file capture with no editor capability.
		const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
		if (!(file instanceof TFile)) return;
		let capture = this.files.get(file);
		if (!capture) {
			capture = {file, text: '', ready: false, ticket: 0, users: 0}; this.files.set(file, capture);
			this.refreshFile(capture);
		}
		return {identity: capture, path: file.path, diagnostic: capture.error};
	}

	retain(source: SurfaceSource): () => void {
		if (this.disposed) return () => {};
		const capture = [...this.files.values()].find(capture => capture === source.identity);
		if (!capture) return () => {};
		capture.users++;
		let released = false;
		return () => {
			if (released) return;
			released = true; capture.users--;
			if (capture.users || this.files.get(capture.file) !== capture) return;
			this.files.delete(capture.file); capture.ticket++; capture.ready = false;
			this.coordinator.detach(capture);
		};
	}

	sourceChanged(editor: Editor, independentUserInput: boolean): void {
		if (this.fromEditor(editor)) this.coordinator.sourceChanged(editor, independentUserInput);
	}

	invalidateEditor(editor: Editor): void {
		if (this.fromEditor(editor)) this.coordinator.invalidateChangedSource(editor);
	}

	fileChanged(file: TFile): void {
		if (this.disposed) return;
		const capture = this.files.get(file);
		if (capture) this.refreshFile(capture);
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const editor of this.editors.keys()) this.coordinator.detach(editor);
		for (const capture of this.files.values()) { capture.ticket++; this.coordinator.detach(capture); }
		this.editors.clear(); this.files.clear(); this.publish(); this.listeners.clear();
	}

	private refreshFile(capture: FileCapture): void {
		capture.ready = false; capture.error = undefined;
		const ticket = ++capture.ticket;
		this.coordinator.detach(capture); this.publish();
		void this.app.vault.read(capture.file).then(text => {
			if (this.disposed || capture.ticket !== ticket || this.app.vault.getAbstractFileByPath(capture.file.path) !== capture.file) return;
			capture.text = text; capture.ready = true;
			const owner: SourceOwner = {identity: capture, file: () => capture.file, text: () => capture.text,
				attached: () => !this.disposed && capture.ready && this.app.vault.getAbstractFileByPath(capture.file.path) === capture.file};
			this.coordinator.attach(owner); this.publish();
		}).catch((error: unknown) => {
			if (this.disposed || capture.ticket !== ticket) return;
			capture.error = `Unable to read the source note: ${error instanceof Error ? error.message : String(error)}`;
			this.publish();
		});
	}

	private publish(): void {
		for (const listener of [...this.listeners]) {
			if (!this.listeners.has(listener)) continue;
			try { listener(); } catch (error: unknown) { console.error('Numerals source subscription failed', error); }
		}
	}
}
