import { MarkdownRenderChild } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type { ReferenceDependency } from '../processing/crossNoteResolver';
import { affectsOccurrence, HostEventSource, HostInvalidation } from './events';

export interface OccurrenceDependencies {
	dependencies: readonly ReferenceDependency[];
	referencedPaths: readonly string[];
}

/** A render child belongs to one actual element, never its parent or expression text. */
export class BlockOccurrence extends MarkdownRenderChild {
	private disposed = false;
	private pending = false;
	private unsubscribe: () => void;
	private dependencies: OccurrenceDependencies = { dependencies: [], referencedPaths: [] };
	private sourcePath: string;

	constructor(readonly element: HTMLElement, private context: MarkdownPostProcessorContext,
		private render: (context: MarkdownPostProcessorContext) => OccurrenceDependencies, private sourceKey: string,
		events: HostEventSource, private readonly released: () => void) {
		super(element);
		this.sourcePath = context.sourcePath;
		this.unsubscribe = events.subscribe(event => this.invalidate(event));
	}

	get isDisposed(): boolean { return this.disposed; }
	ownedBy(context: MarkdownPostProcessorContext): boolean { return context === this.context && context.sourcePath === this.sourcePath; }

	refresh(context: MarkdownPostProcessorContext, render: (context: MarkdownPostProcessorContext) => OccurrenceDependencies, sourceKey: string): void {
		if (this.disposed) return;
		this.context = context;
		this.sourcePath = context.sourcePath;
		this.render = render;
		if (sourceKey === this.sourceKey) return;
		this.sourceKey = sourceKey;
		this.renderNow();
	}

	renderNow(): void {
		if (this.disposed) return;
		this.pending = false;
		const currentContext = this.getContext();
		try { this.dependencies = this.render(currentContext); } catch (error) {
			// Preserve dependency information so an input/settings repair can recover.
			this.element.empty();
			this.element.createDiv({ cls: 'numerals-error-line', text: `Numerals: ${error instanceof Error ? error.message : 'Unable to render this calculation.'}` });
		}
	}

	getContext(): MarkdownPostProcessorContext {
		const context = this.context;
		return { ...context, sourcePath: this.sourcePath,
			getSectionInfo: element => context.getSectionInfo(element), addChild: child => context.addChild(child) };
	}

	private invalidate(event: HostInvalidation): void {
		if (event.kind === 'unload') { this.dispose(); return; }
		if (!affectsOccurrence(event, this.sourcePath, this.dependencies.dependencies, this.dependencies.referencedPaths)) return;
		if (event.kind === 'rename' && event.oldPath === this.sourcePath) this.sourcePath = event.newPath;
		if (this.pending || this.disposed) return;
		this.pending = true;
		void Promise.resolve().then(() => { if (!this.disposed && this.pending) this.renderNow(); });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.pending = false;
		this.unsubscribe();
		this.released();
	}

	onunload(): void { this.dispose(); }
}
