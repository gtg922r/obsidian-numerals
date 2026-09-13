import type { MarkdownPostProcessorContext } from 'obsidian';
import type { SourceSnapshotState } from './snapshotCoordinator';
import { SourceRegistry, type SurfaceSource } from './sourceRegistry';

/** Occurrence-owned subscription; replacing or removing it aborts pending MathJax. */
export class SurfaceSubscription {
	private stopRegistry: () => void;
	private stopSource = () => {};
	private releaseSource = () => {};
	private subscribed = false;
	private source?: SurfaceSource;
	private controller = new AbortController();
	private disposed = false;
	private refreshing = false;
	private dirty = false;
	private queued = false;

	constructor(private readonly registry: SourceRegistry, private readonly element: HTMLElement,
		private readonly context: MarkdownPostProcessorContext,
		private readonly render: (source: SurfaceSource | undefined, state: SourceSnapshotState | undefined, signal: AbortSignal) => void,
		private readonly renderError: (message: string, signal: AbortSignal) => void) {
		this.stopRegistry = registry.subscribe(() => this.refresh());
	}

	refresh(): void {
		if (this.disposed) return;
		if (this.refreshing) { this.dirty = true; return; }
		this.refreshing = true;
		try {
			const source = this.registry.fromOccurrence(this.element, this.context);
			if (source?.identity !== this.source?.identity) {
				this.stopSource(); this.releaseSource(); this.source = source; this.subscribed = false;
				this.releaseSource = source ? this.registry.retain(source) : () => {};
			}
			// A file capture can attach after this occurrence first subscribed.
			const current = source && this.registry.coordinator.current(source.identity);
			if (!current) { this.stopSource(); this.subscribed = false; }
			else if (!this.subscribed) {
				this.stopSource = this.registry.coordinator.subscribe(source.identity, () => this.refresh()); this.subscribed = true;
			}
			this.controller.abort(); this.controller = new AbortController();
			this.render(source, current, this.controller.signal);
		} catch (error: unknown) {
			this.renderError(error instanceof Error ? error.message : String(error), this.controller.signal);
		} finally {
			this.refreshing = false;
			if (this.dirty && !this.queued && !this.disposed) {
				this.dirty = false; this.queued = true;
				void Promise.resolve().then(() => { this.queued = false; if (!this.disposed) this.refresh(); });
			}
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true; this.controller.abort(); this.stopRegistry(); this.stopSource(); this.releaseSource();
	}
}
