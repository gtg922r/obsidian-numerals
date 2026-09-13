import type { NoteDependencyChange } from './dependencies';
import {
	captureNoteEvaluationInput, evaluateNote, type CapturedNoteEvaluationInput, type NoteEvaluationRequest,
} from './evaluateNote';
import { generationKey, NoteEvaluationService, type NoteServiceInput, type NoteServiceState } from './noteService';
import type { NoteSnapshot } from './noteSnapshot';

export interface NoteEvaluationClock {
	/** Use the same monotonic time origin as Dataview pending.startedAtMs. */
	now(): number;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface NoteEvaluationServiceOptions {
	readonly clock?: NoteEvaluationClock;
	readonly onSubscriberError?: (error: unknown) => void;
}

interface CapturedGeneration {
	readonly baseKey: string;
	readonly deadline?: number;
	captured: CapturedNoteEvaluationInput;
	expired: boolean;
	timer?: { readonly handle: unknown };
}

const defaultClock: NoteEvaluationClock = {
	now: () => performance.now(),
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
	clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/**
 * Shared concrete facade for complete note evaluation. Its captured inputs remain
 * private; host surfaces receive only snapshots. The owner must dispose it.
 */
export class CompleteNoteEvaluationService {
	private readonly service: NoteEvaluationService<CapturedNoteEvaluationInput>;
	private readonly captures = new Map<string, CapturedGeneration>();
	private readonly clock: NoteEvaluationClock;
	private disposed = false;

	constructor(options: NoteEvaluationServiceOptions = {}) {
		this.clock = options.clock ?? defaultClock;
		this.service = new NoteEvaluationService({
			capture: captured => captured,
			evaluate: (captured, signal) => evaluateNote(captured, signal),
			onSubscriberError: options.onSubscriberError,
		});
	}

	request(input: NoteEvaluationRequest): Promise<NoteSnapshot | undefined> {
		this.assertLive();
		const sourceId = input.generation.sourceId;
		const baseKey = generationKey(input.generation);
		const previous = this.captures.get(sourceId);
		if (previous && previous.baseKey === baseKey && previous.captured.runtime.engine === input.runtime.engine &&
			previous.captured.runtime.configurationError === input.runtime.configurationError) {
			// Same-generation requests cannot replace already captured metadata or
			// restart a completed deadline. Only the presentation may change.
			previous.captured = { ...previous.captured, runtime: { ...previous.captured.runtime, formatter: input.runtime.formatter } };
			return this.requestCaptured(previous);
		}
		this.retire(sourceId);
		const captured = captureNoteEvaluationInput({ ...input, nowMs: input.nowMs ?? this.clock.now() });
		const record: CapturedGeneration = {
			baseKey, captured, expired: false,
			deadline: captured.metadata.freshness.status === 'pending' ? captured.metadata.freshness.retryAtMs : undefined,
		};
		this.captures.set(sourceId, record);
		return this.requestCaptured(record);
	}

	current(sourceId: string): NoteServiceState | undefined { return this.service.current(sourceId); }

	subscribe(sourceId: string, listener: (state: NoteServiceState) => void): () => void {
		return this.service.subscribe(sourceId, listener);
	}

	sourcesAffectedBy(change: NoteDependencyChange): readonly string[] { return this.service.sourcesAffectedBy(change); }

	updatePresentation(sourceId: string, runtime: NoteServiceInput['runtime']): NoteSnapshot | undefined {
		this.assertLive();
		const record = this.captures.get(sourceId);
		if (record) {
			if (record.captured.runtime.engine !== runtime.engine) throw new Error('Runtime replacement requires a new evaluation generation.');
			if (record.captured.runtime.configurationError !== runtime.configurationError) throw new Error('Configuration changes require a new evaluation generation.');
			// Store before publication so a nested presentation update remains the
			// latest formatter for a later deadline status refresh.
			record.captured = { ...record.captured, runtime: { ...record.captured.runtime, formatter: runtime.formatter } };
		}
		return this.service.updatePresentation(sourceId, runtime);
	}

	invalidate(sourceId: string): void { this.assertLive(); this.retire(sourceId); }

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const record of this.captures.values()) this.cancelTimer(record);
		this.captures.clear();
		this.service.dispose();
	}

	private requestCaptured(record: CapturedGeneration): Promise<NoteSnapshot | undefined> {
		this.expireIfDue(record);
		if (!this.isCurrent(record)) return Promise.resolve(undefined);
		const promise = this.service.request(record.captured);
		this.armDeadline(record);
		return promise;
	}

	private expireIfDue(record: CapturedGeneration): void {
		if (record.expired || record.captured.metadata.freshness.status !== 'pending') return;
		const now = this.clock.now();
		if (Number.isFinite(record.deadline) && Number.isFinite(now) && now < record.deadline!) return;
		this.cancelTimer(record);
		record.expired = true;
		const captured = record.captured;
		const reason = 'Dataview deadline elapsed without verified buffer metadata; using the captured native metadata.';
		record.captured = {
			...captured,
			metadata: {
				...captured.metadata, entries: captured.metadata.nativeEntries,
				freshness: { ...captured.metadata.freshness, status: 'unverified', projectionUsed: false,
					allowsAutomaticInsertion: false, retryAtMs: undefined, reason },
			},
		};
		// Both pending and expired states use these exact captured native entries.
		// Change only readiness; repeating math could repeat random or engine effects.
		this.service.expireMetadata(captured, {reason, pendingReason: captured.metadata.freshness.reason});
	}

	private armDeadline(record: CapturedGeneration): void {
		if (!this.isCurrent(record) || record.expired || record.timer || record.deadline === undefined) return;
		record.timer = { handle: this.clock.setTimeout(() => {
			record.timer = undefined;
			if (!this.isCurrent(record)) return;
			this.expireIfDue(record);
			if (!record.expired) { this.armDeadline(record); return; }
		}, Math.max(0, record.deadline - this.clock.now())) };
	}

	private cancelTimer(record: CapturedGeneration): void {
		if (record.timer) this.clock.clearTimeout(record.timer.handle);
		record.timer = undefined;
	}

	private retire(sourceId: string): void {
		const previous = this.captures.get(sourceId);
		if (previous) this.cancelTimer(previous);
		this.captures.delete(sourceId);
		this.service.invalidate(sourceId);
	}

	private isCurrent(record: CapturedGeneration): boolean {
		return !this.disposed && this.captures.get(record.captured.generation.sourceId) === record;
	}

	private assertLive(): void { if (this.disposed) throw new Error('Note evaluation service is disposed.'); }
}

export function createNoteEvaluationService(options: NoteEvaluationServiceOptions = {}): CompleteNoteEvaluationService {
	return new CompleteNoteEvaluationService(options);
}
