import type { MathJsInstance } from 'mathjs';
import type { ResultFormatter } from '../formatting/types';
import type { NoteGeneration, NoteSnapshot } from './noteSnapshot';
import { createNoteSnapshot, expireNoteSnapshotMetadata, reformatNoteSnapshot, type MetadataDeadlineUpdate } from './noteSnapshot';
import { dependsOnChange, NoteDependencyChange } from './dependencies';

export interface NoteServiceInput {
	readonly generation: NoteGeneration;
	readonly runtime: { readonly engine: MathJsInstance; readonly formatter: ResultFormatter; readonly configurationError?: string };
}

export type NoteServiceState =
	| { readonly status: 'pending'; readonly generation: NoteGeneration }
	| { readonly status: 'ready'; readonly snapshot: NoteSnapshot }
	| { readonly status: 'error'; readonly generation: NoteGeneration; readonly message: string };

export interface NoteServiceAdapter<Input extends NoteServiceInput, Captured extends NoteServiceInput = Input> {
	/** Synchronously detach all source/metadata/settings input before the first await. */
	capture(input: Input): Captured;
	/** Must never retain an old populated scope for a new generation. */
	evaluate(input: Captured, signal: AbortSignal): NoteSnapshot | Promise<NoteSnapshot>;
	onSubscriberError?(error: unknown): void;
}

interface ServiceEntry {
	readonly key: string;
	readonly engine: MathJsInstance;
	readonly generation: NoteGeneration;
	readonly configurationError?: string;
	readonly controller: AbortController;
	formatter: ResultFormatter;
	metadataDeadline?: MetadataDeadlineUpdate;
	promise: Promise<NoteSnapshot | undefined>;
	state: NoteServiceState;
}

interface NoteSubscription {
	readonly listener: (state: NoteServiceState) => void;
}

/**
 * Coordinates complete note generations for every surface. Buffer identity is
 * the ownership key; source path is separately retained for references and writes.
 * Cursor, viewport, selection and formatting never enter the mathematical key.
 */
export class NoteEvaluationService<Input extends NoteServiceInput, Captured extends NoteServiceInput = Input> {
	private readonly entries = new Map<string, ServiceEntry>();
	private readonly listeners = new Map<string, Set<NoteSubscription>>();
	private disposed = false;

	constructor(private readonly adapter: NoteServiceAdapter<Input, Captured>) {}

	request(input: Input): Promise<NoteSnapshot | undefined> {
		this.assertLive();
		const captured = this.adapter.capture(input);
		const generation = Object.freeze({ ...captured.generation });
		const key = generationKey(generation);
		const previous = this.entries.get(generation.sourceId);
		if (previous?.key === key && previous.engine === captured.runtime.engine &&
			previous.configurationError === captured.runtime.configurationError && previous.state.status !== 'error') {
			if (previous.formatter !== captured.runtime.formatter) this.updatePresentation(generation.sourceId, captured.runtime);
			if (!this.isCurrent(previous)) return Promise.resolve(undefined);
			return previous.promise;
		}
		previous?.controller.abort();
		const controller = new AbortController();
		const entry: ServiceEntry = {
			key, engine: captured.runtime.engine, generation, controller, formatter: captured.runtime.formatter,
			configurationError: captured.runtime.configurationError,
			state: Object.freeze({ status: 'pending', generation }), promise: Promise.resolve(undefined),
		};
		this.entries.set(generation.sourceId, entry);
		// Schedule after ownership is installed, so even synchronous adapters can
		// be superseded before they begin and async adapters cannot publish stale work.
		entry.promise = Promise.resolve().then(async () => {
			if (!this.isCurrent(entry)) return undefined;
			try {
				const evaluated = captured.runtime.configurationError
					? createNoteSnapshot({ generation, calculations: [], symbols: [], metadataStatus: 'native-ready',
						diagnostics: [{kind: 'configuration', message: captured.runtime.configurationError}] }, entry.engine, entry.formatter)
					: await this.adapter.evaluate(captured, controller.signal);
				if (!this.isCurrent(entry)) return undefined;
				if (generationKey(evaluated.generation) !== key) throw new Error('Evaluator returned a snapshot for a different note generation.');
				const formatted = reformatNoteSnapshot(evaluated, entry.engine, entry.formatter);
				const snapshot = entry.metadataDeadline
					? expireNoteSnapshotMetadata(formatted, entry.engine, entry.metadataDeadline) : formatted;
				entry.state = Object.freeze({ status: 'ready', snapshot });
				this.publish(generation.sourceId, entry.state);
				return this.isCurrent(entry) && entry.state.status === 'ready' ? entry.state.snapshot : undefined;
			} catch (error: unknown) {
				if (!this.isCurrent(entry)) return undefined;
				entry.state = Object.freeze({ status: 'error', generation, message: error instanceof Error ? error.message : String(error) });
				this.publish(generation.sourceId, entry.state);
				if (!this.isCurrent(entry)) return undefined;
				throw error;
			}
		});
		this.publish(generation.sourceId, entry.state);
		return entry.promise;
	}

	/** Rebuild presentation from retained raw values; this never calls evaluate. */
	updatePresentation(sourceId: string, runtime: NoteServiceInput['runtime']): NoteSnapshot | undefined {
		this.assertLive();
		const entry = this.entries.get(sourceId);
		if (!entry) return undefined;
		if (entry.engine !== runtime.engine) throw new Error('Runtime replacement requires a new evaluation generation.');
		if (entry.configurationError !== runtime.configurationError) throw new Error('Configuration changes require a new evaluation generation.');
		entry.formatter = runtime.formatter;
		if (entry.state.status !== 'ready') return undefined;
		const snapshot = reformatNoteSnapshot(entry.state.snapshot, runtime.engine, runtime.formatter);
		entry.state = Object.freeze({ status: 'ready', snapshot });
		entry.promise = Promise.resolve(snapshot);
		this.publish(sourceId, entry.state);
		return this.isCurrent(entry) && entry.state.status === 'ready' ? entry.state.snapshot : undefined;
	}

	/**
	 * Deadline-only status change for identical native inputs. Pending work keeps
	 * its one evaluation; errors are not retried. Real input changes need request.
	 */
	expireMetadata(input: NoteServiceInput, update: MetadataDeadlineUpdate): NoteSnapshot | undefined {
		this.assertLive();
		const entry = this.entries.get(input.generation.sourceId);
		if (!entry || entry.key !== generationKey(input.generation) || entry.engine !== input.runtime.engine ||
			entry.configurationError !== input.runtime.configurationError || entry.metadataDeadline) return undefined;
		entry.metadataDeadline = {reason: update.reason, pendingReason: update.pendingReason};
		if (entry.state.status !== 'ready') return undefined;
		const snapshot = expireNoteSnapshotMetadata(entry.state.snapshot, entry.engine, entry.metadataDeadline);
		if (snapshot === entry.state.snapshot) return snapshot;
		entry.state = Object.freeze({ status: 'ready', snapshot });
		entry.promise = Promise.resolve(snapshot);
		this.publish(entry.generation.sourceId, entry.state);
		return this.isCurrent(entry) && entry.state.status === 'ready' ? entry.state.snapshot : undefined;
	}

	current(sourceId: string): NoteServiceState | undefined {
		this.assertLive();
		return this.entries.get(sourceId)?.state;
	}

	/**
	 * Hosts advance dependency revisions and request these buffers again. Pending
	 * and failed captures may not yet have published their full dependency table.
	 */
	sourcesAffectedBy(change: NoteDependencyChange): readonly string[] {
		this.assertLive();
		return [...this.entries].filter(([, entry]) => entry.state.status !== 'ready' || entry.generation.sourcePath === change.path ||
			(change.kind === 'rename' && entry.generation.sourcePath === change.oldPath) ||
			dependsOnChange(entry.state.snapshot.dependencies, change)).map(([sourceId]) => sourceId);
	}

	subscribe(sourceId: string, listener: (state: NoteServiceState) => void): () => void {
		this.assertLive();
		let subscribers = this.listeners.get(sourceId);
		if (!subscribers) { subscribers = new Set(); this.listeners.set(sourceId, subscribers); }
		const subscription = {listener};
		subscribers.add(subscription);
		const current = this.entries.get(sourceId)?.state;
		if (current) this.notify(listener, current);
		return () => {
			subscribers.delete(subscription);
			if (!subscribers.size && this.listeners.get(sourceId) === subscribers) this.listeners.delete(sourceId);
		};
	}

	/** Host adapters call this when a buffer closes or an input dependency changes. */
	invalidate(sourceId: string): void {
		this.assertLive();
		this.entries.get(sourceId)?.controller.abort();
		this.entries.delete(sourceId);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const entry of this.entries.values()) entry.controller.abort();
		this.entries.clear();
		this.listeners.clear();
	}

	private isCurrent(entry: ServiceEntry): boolean {
		return !this.disposed && !entry.controller.signal.aborted && this.entries.get(entry.generation.sourceId) === entry;
	}
	private assertLive(): void { if (this.disposed) throw new Error('Note evaluation service is disposed.'); }
	private publish(sourceId: string, state: NoteServiceState): void {
		for (const subscription of [...(this.listeners.get(sourceId) ?? [])]) {
			if (this.entries.get(sourceId)?.state !== state) break;
			if (this.listeners.get(sourceId)?.has(subscription)) this.notify(subscription.listener, state);
		}
	}
	private notify(listener: (state: NoteServiceState) => void, state: NoteServiceState): void {
		try { listener(state); } catch (error: unknown) {
			try { this.adapter.onSubscriberError?.(error); } catch { /* Error reporting cannot break another surface's subscription. */ }
		}
	}
}

/** Fixed ordered fields avoid relying on caller object key order or a text hash. */
export function generationKey(generation: NoteGeneration): string {
	return JSON.stringify([generation.sourceId, generation.sourcePath, generation.sourceRevision,
		generation.sourceText, generation.metadataRevision, generation.dependencyRevision,
		generation.evaluationSettingsRevision, generation.runtimeGeneration]);
}
