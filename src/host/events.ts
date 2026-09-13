import type { App, CachedMetadata, EventRef, TAbstractFile, TFile } from 'obsidian';
import type { ReferenceDependency } from '../processing/crossNoteResolver';
import type { SettingsChange } from '../settings/changes';

export type HostInvalidation =
	| { kind: 'metadata' | 'dataview' | 'create' | 'delete'; paths: readonly string[] }
	| { kind: 'rename'; paths: readonly string[]; oldPath: string; newPath: string }
	| { kind: 'ready' | 'unload'; paths: readonly string[] }
	| { kind: 'settings'; paths: readonly string[]; change: SettingsChange };

export interface HostEventSource {
	subscribe(listener: (event: HostInvalidation) => void): () => void;
}
export type SubscribeSettings = (listener: (change: SettingsChange) => void) => () => void;

function pathOf(file: unknown): string | undefined {
	return file !== null && typeof file === 'object' && 'path' in file && typeof file.path === 'string'
		? file.path : undefined;
}

/** One host subscription set per plugin, active even before Dataview is ready. */
export class HostEventHub implements HostEventSource {
	private listeners = new Set<(event: HostInvalidation) => void>();
	private cleanups: (() => void)[] = [];
	private disposed = false;
	private pendingEvents: HostInvalidation[] = [];
	private emitting = false;

	constructor(private readonly app: App, private readonly subscribeSettings?: SubscribeSettings) {}

	subscribe(listener: (event: HostInvalidation) => void): () => void {
		if (this.disposed) return () => {};
		// Each registration owns its cleanup, even if callbacks happen to be identical.
		const subscription = (event: HostInvalidation) => listener(event);
		this.listeners.add(subscription);
		if (this.listeners.size === 1) this.connect();
		return () => {
			this.listeners.delete(subscription);
			if (this.listeners.size === 0) this.disconnect();
		};
	}

	private emit(event: HostInvalidation): void {
		if (this.disposed) return;
		this.pendingEvents.push(event);
		if (this.emitting) return;
		this.emitting = true;
		try {
			while (this.pendingEvents.length && !this.disposed) {
				const current = this.pendingEvents.shift()!;
				for (const listener of [...this.listeners]) {
					if (this.disposed) break;
					if (!this.listeners.has(listener)) continue;
					try { listener(current); } catch (error) { console.error('Numerals host invalidation failed', error); }
				}
			}
		} finally { this.emitting = false; }
	}

	private connect(): void {
		const cache = this.app.metadataCache, vault = this.app.vault;
		const metadata = (file: TFile, _data: string, _cache: CachedMetadata) => {
			const path = pathOf(file);
			if (path) this.emit({ kind: 'metadata', paths: [path] });
		};
		const dataview = (_type: unknown, file: unknown, oldPath?: unknown) => {
			const path = pathOf(file);
			if (path) this.emit({ kind: 'dataview', paths: typeof oldPath === 'string' ? [path, oldPath] : [path] });
		};
		const cacheRefs: EventRef[] = [cache.on('changed', metadata),
			// @ts-expect-error Dataview adds these events to Obsidian's metadata cache.
			cache.on('dataview:metadata-change', dataview),
			// @ts-expect-error Dataview can finish loading after Numerals subscribers exist.
			cache.on('dataview:api-ready', () => this.emit({ kind: 'ready', paths: [] })),
		];
		this.cleanups.push(() => { for (const ref of cacheRefs) cache.offref(ref); });
		const fileEvent = (kind: 'create' | 'delete') => (file: TAbstractFile) => {
			const path = pathOf(file);
			if (path) this.emit({ kind, paths: [path] });
		};
		const vaultRefs = [vault.on('create', fileEvent('create')), vault.on('delete', fileEvent('delete')),
			vault.on('rename', (file, oldPath) => {
				this.emit({ kind: 'rename', paths: [oldPath, file.path], oldPath, newPath: file.path });
			}),
		];
		this.cleanups.push(() => { for (const ref of vaultRefs) vault.offref(ref); });
		if (this.subscribeSettings) this.cleanups.push(this.subscribeSettings(change => {
			this.emit({ kind: 'settings', paths: [], change });
		}));
	}

	private disconnect(): void {
		for (const cleanup of this.cleanups.splice(0)) cleanup();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.pendingEvents = [];
		for (const listener of [...this.listeners]) {
			try { listener({ kind: 'unload', paths: [] }); } catch (error) { console.error('Numerals host cleanup failed', error); }
		}
		this.listeners.clear();
		this.disconnect();
	}
}

/** Events invalidate inputs; they never certify a source or metadata generation. */
export function affectsOccurrence(event: HostInvalidation, sourcePath: string,
	dependencies: readonly ReferenceDependency[], referencedPaths: readonly string[] = []): boolean {
	if (event.kind === 'unload') return false;
	if (event.kind === 'settings') return event.change.effects.has('evaluation') || event.change.effects.has('presentation');
	if (event.kind === 'ready' || event.paths.includes(sourcePath)) return true;
	if ((event.kind === 'create' || event.kind === 'delete' || event.kind === 'rename') &&
		(dependencies.length > 0 || referencedPaths.length > 0)) return true;
	return event.paths.some(path => referencedPaths.includes(path) || dependencies.some(dependency => dependency.resolvedPath === path)) ||
		dependencies.some(dependency => dependency.resolvedPath === undefined);
}
