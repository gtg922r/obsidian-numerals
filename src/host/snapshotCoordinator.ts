import type { Editor } from 'obsidian';
import type { NumeralsSettings } from '../numerals.types';
import type { NumeralsRuntimeContext } from '../settings/runtimeState';
import type { NoteEvaluationRequest } from '../evaluation/evaluateNote';
import type { NoteGeneration, NoteSnapshot } from '../evaluation/noteSnapshot';
import type { NoteServiceState } from '../evaluation/noteService';
import { createNoteEvaluationService } from '../evaluation/service';
import { indexNote, type NoteSourceIndex } from '../evaluation/sourceIndex';
import type { NoteDependencyChange } from '../evaluation/dependencies';
import { prepareInsertions, type InsertionBatch } from './snapshotInsertion';

export interface SourceFile { readonly path: string }

/** Implemented by a proved full editor attachment or a read-only file capture. */
export interface SourceOwner {
	readonly identity: object;
	readonly editor?: Editor;
	file(): SourceFile | undefined;
	text(): string;
	attached(): boolean;
}

export interface SnapshotConfiguration {
	readonly settings: NumeralsSettings;
	readonly runtime: NumeralsRuntimeContext;
	readonly settingsGeneration: number;
	readonly evaluationSettingsGeneration: number;
}

/** The same narrow state/subscription boundary is used by suggestions and surfaces. */
export interface SourceSnapshotState {
	readonly sourceId: string;
	readonly index: NoteSourceIndex;
	readonly state: NoteServiceState;
	readonly settings: NumeralsSettings;
	readonly insertionExhausted: boolean;
}

export interface CoordinatorInputs {
	configuration(): SnapshotConfiguration;
	/** Capture before scheduling math. An async host read must honor this abort signal. */
	capture(index: NoteSourceIndex, configuration: SnapshotConfiguration, signal: AbortSignal, isCurrent: () => boolean):
		Pick<NoteEvaluationRequest, 'parseYaml' | 'dataview' | 'references'> |
		Promise<Pick<NoteEvaluationRequest, 'parseYaml' | 'dataview' | 'references'>>;
}

type EvaluationService = ReturnType<typeof createNoteEvaluationService>;
interface Session {
	readonly id: string;
	owner: SourceOwner;
	file: SourceFile;
	text: string;
	revision: number;
	metadataRevision: number;
	dependencyRevision: number;
	configuration: SnapshotConfiguration;
	index: NoteSourceIndex;
	state: NoteServiceState;
	controller: AbortController;
	allowAutomatic: boolean;
	stop: () => void;
	readonly listeners: Set<() => void>;
}

/** Only suppresses echoes. Hash equality NEVER establishes source/write ownership. */
function echoKey(text: string): string {
	let first = 2166136261, second = 5381;
	for (let i = 0; i < text.length; i++) {
		first = Math.imul(first ^ text.charCodeAt(i), 16777619);
		second = Math.imul(second, 33) ^ text.charCodeAt(i);
	}
	return `${text.length}:${first >>> 0}:${second >>> 0}`;
}

/** Owns one mathematical generation per full source, independently of its widgets. */
export class SnapshotCoordinator {
	private readonly sessions = new Map<object, Session>();
	private readonly echoes = new WeakMap<SourceFile, Set<string>>();
	private readonly ownWrites = new WeakMap<Editor, {before: string; after: string}>();
	private nextId = 0;
	private disposed = false;

	constructor(private readonly inputs: CoordinatorInputs,
		private readonly service: EvaluationService = createNoteEvaluationService()) {}

	/** Caller must prove the actual editor/file attachment; layout signals are not proof. */
	attach(owner: SourceOwner): void {
		if (this.disposed || !owner.attached()) return;
		if (owner.editor && owner.identity !== owner.editor) return;
		const file = owner.file();
		if (!file) return;
		const previous = this.sessions.get(owner.identity);
		if (previous && previous.file === file) {
			previous.owner = owner;
			this.sourceChanged(owner.identity, false);
			return;
		}
		if (previous) this.detach(owner.identity);
		const configuration = this.inputs.configuration(), text = owner.text();
		const id = `numerals-source-${++this.nextId}`;
		const index = this.index(id, 0, file.path, text, configuration);
		const generation = this.generation(id, file.path, text, 0, 0, 0, configuration);
		const session: Session = { id, owner, file, text, revision: 0, metadataRevision: 0, dependencyRevision: 0,
			configuration, index, state: {status: 'pending', generation}, controller: new AbortController(),
			allowAutomatic: Boolean(owner.editor) && !this.echoes.get(file)?.has(echoKey(text)),
			stop: () => {}, listeners: new Set() };
		this.sessions.set(owner.identity, session);
		session.stop = this.service.subscribe(id, state => {
			if (!this.live(session)) return;
			session.state = state;
			this.publish(session);
			if (state.status === 'ready') {
				// Never recursively dispatch from a CM update or a service notification.
				void Promise.resolve().then(() => {
					if (this.live(session) && session.state === state) this.insert(owner.identity, false);
				});
			}
		});
		this.request(session);
	}

	/** A true root is supplied only by the correlated trusted-input adapter, never an event counter. */
	sourceChanged(identity: object, independentUserInput: boolean): void {
		const session = this.sessions.get(identity);
		if (!session || !this.live(session)) return;
		const text = session.owner.text();
		if (text === session.text && session.file.path === session.index.source.path) {
			if (session.controller.signal.aborted) {
				// A rapid change/revert still retired the prior work. Recover with a
				// fresh revision, but equal text is not proof of an independent root.
				session.revision++; session.allowAutomatic = false; this.request(session);
			}
			return;
		}
		const ownWrite = session.owner.editor && this.isOwnChange(session.owner.editor, session.text, text);
		session.text = text;
		session.revision++;
		session.allowAutomatic = independentUserInput && !ownWrite;
		this.request(session);
	}

	/** Metadata/dependency signals change inputs, never write permission. */
	inputsChanged(change?: NoteDependencyChange): void {
		if (this.disposed) return;
		const affected = change ? new Set(this.service.sourcesAffectedBy(change)) : undefined;
		for (const session of this.sessions.values()) {
			if (!this.live(session)) continue;
			if (affected && session.state.status === 'ready' && !affected.has(session.id)) continue;
			session.metadataRevision++;
			session.dependencyRevision++;
			// Unknown source changes discovered during metadata work retire old permission.
			if (session.owner.text() !== session.text) {
				session.text = session.owner.text(); session.revision++; session.allowAutomatic = false;
			}
			this.request(session);
		}
	}

	settingsChanged(evaluation: boolean): void {
		if (this.disposed) return;
		for (const session of this.sessions.values()) {
			if (!this.live(session)) continue;
			const configuration = this.inputs.configuration();
			if (evaluation || configuration.runtime.engine !== session.configuration.runtime.engine) {
				session.allowAutomatic = false;
				this.request(session);
			} else {
				session.configuration = configuration;
				this.service.updatePresentation(session.id, configuration.runtime);
				this.publish(session);
			}
		}
	}

	/** Stable live attachment identity, including a temporarily mismatched buffer.
	 * This does not establish snapshot validity or grant an editor write capability. */
	attachmentId(identity: object): string | undefined {
		const session = this.sessions.get(identity);
		return session && this.live(session) ? session.id : undefined;
	}

	current(identity: object): SourceSnapshotState | undefined {
		const session = this.sessions.get(identity);
		if (!session || !this.live(session) || session.owner.text() !== session.text) return undefined;
		return {sourceId: session.id, index: session.index, state: session.state,
			settings: session.configuration.settings, insertionExhausted: !session.allowAutomatic};
	}

	/** Cancel immediately when the public editor changed, without classifying its input root. */
	invalidateChangedSource(identity: object): void {
		const session = this.sessions.get(identity);
		if (!session || !this.live(session) || session.owner.text() === session.text) return;
		session.controller.abort(); this.service.invalidate(session.id);
		const generation = session.state.status === 'ready' ? session.state.snapshot.generation : session.state.generation;
		session.state = {status: 'pending', generation};
		// Keep the old text/revision until sourceChanged consumes the actual CM
		// transaction. Updating it here would discard a later positive input witness.
		this.publish(session);
	}

	/** Trusted presentation preparation retains the engine of this exact current snapshot. */
	renderContext(identity: object, snapshot: NoteSnapshot): NumeralsRuntimeContext | undefined {
		const session = this.sessions.get(identity);
		return session && this.ready(session, snapshot) ? session.configuration.runtime : undefined;
	}

	subscribe(identity: object, listener: () => void): () => void {
		const session = this.sessions.get(identity);
		if (!session) return () => {};
		const receive = () => listener();
		session.listeners.add(receive);
		return () => session.listeners.delete(receive);
	}

	/** A read-only command availability check; no capture, evaluation, rearming or dispatch. */
	canInsert(identity: object): boolean { return Boolean(this.batch(identity)); }

	isOwnChange(editor: Editor, before: string, after: string): boolean {
		const receipt = this.ownWrites.get(editor);
		return receipt?.before === before && receipt.after === after;
	}

	/** Explicit invocation grants only this batch; it never leaves permission for a future event. */
	insert(identity: object, explicit: boolean): boolean {
		const session = this.sessions.get(identity);
		if (!session?.owner.editor || session.state.status !== 'ready' || (!explicit && !session.allowAutomatic)) return false;
		const attemptedState = session.state, notifyExhaustion = session.allowAutomatic;
		// A ready attempt spends this cycle even if output already matches, every
		// proposal is ineligible, or a final guard fails. Pending capture spends none.
		session.allowAutomatic = false;
		try {
			const batch = this.batch(identity);
			if (!batch) return false;
			const editor = session.owner.editor;
			// Revalidate AFTER formatting every proposal, immediately before one transaction.
			if (!this.ready(session, batch.snapshot) || !batch.valid(session.configuration.runtime.engine)) return false;
			let receipts = this.echoes.get(session.file);
			if (!receipts) { receipts = new Set(); this.echoes.set(session.file, receipts); }
			receipts.add(echoKey(batch.after));
			this.ownWrites.set(editor, {before: session.text, after: batch.after});
			try {
				editor.transaction({changes: batch.changes.map(change => ({
					from: editor.offsetToPos(change.start), to: editor.offsetToPos(change.end), text: change.replacement,
				}))}, 'numerals-insertion');
			} catch (error: unknown) {
				this.fail(session, error);
				return false;
			}
			if (this.live(session)) this.sourceChanged(identity, false);
			return true;
		} finally {
			// A no-op has no source publication of its own. Notify once outside the
			// attempt; a newer source/state already publishes its current permission.
			if (notifyExhaustion) void Promise.resolve().then(() => {
				if (this.live(session) && session.state === attemptedState && !session.allowAutomatic) this.publish(session);
			});
		}
	}

	detach(identity: object): void {
		const session = this.sessions.get(identity);
		if (!session) return;
		this.sessions.delete(identity);
		session.controller.abort(); session.stop();
		this.service.invalidate(session.id);
		this.publish(session); session.listeners.clear();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const identity of this.sessions.keys()) this.detach(identity);
		this.service.dispose();
	}

	private batch(identity: object): InsertionBatch | undefined {
		const session = this.sessions.get(identity);
		if (!session?.owner.editor || session.state.status !== 'ready' || !this.ready(session, session.state.snapshot)) return;
		return prepareInsertions(session.state.snapshot, session.index, session.configuration.runtime.engine);
	}

	private ready(session: Session, snapshot: NoteSnapshot): boolean {
		if (!this.live(session) || session.owner.text() !== session.text || session.file.path !== session.index.source.path) return false;
		const configuration = this.inputs.configuration();
		if (configuration.settingsGeneration !== session.configuration.settingsGeneration ||
			configuration.evaluationSettingsGeneration !== session.configuration.evaluationSettingsGeneration ||
			configuration.runtime !== session.configuration.runtime) return false;
		const current = this.service.current(session.id);
		return current?.status === 'ready' && current.snapshot === snapshot && session.state.status === 'ready' &&
			session.state.snapshot === snapshot && snapshot.generation.sourceText === session.text;
	}

	private live(session: Session): boolean {
		return !this.disposed && this.sessions.get(session.owner.identity) === session && session.owner.attached() &&
			session.owner.file() === session.file;
	}

	private request(session: Session): void {
		session.controller.abort(); session.controller = new AbortController();
		const controller = session.controller;
		this.service.invalidate(session.id);
		const configuration = this.inputs.configuration();
		session.configuration = configuration;
		const generation = this.generation(session.id, session.file.path, session.text, session.revision,
			session.metadataRevision, session.dependencyRevision, configuration);
		const index = this.index(session.id, session.revision, session.file.path, session.text, configuration);
		session.index = index; session.state = {status: 'pending', generation};
		this.publish(session); // invalidate() itself does not publish; clear old UI now.
		const current = () => this.live(session) && session.controller === controller && !controller.signal.aborted;
		const evaluationCurrent = () => {
			if (!current() || session.owner.text() !== generation.sourceText || session.file.path !== generation.sourcePath) return false;
			const latest = this.inputs.configuration();
			return latest.evaluationSettingsGeneration === configuration.evaluationSettingsGeneration &&
				latest.runtime.engine === configuration.runtime.engine && latest.runtime.currencyGeneration === configuration.runtime.currencyGeneration &&
				latest.runtime.configurationError === configuration.runtime.configurationError;
		};
		if (!evaluationCurrent()) return;
		// Host capture checks this again after target-file reads and BEFORE invoking
		// the shared metadata/reference collector, which can itself execute mathematics.
		const captured = () => this.inputs.capture(index, configuration, controller.signal, evaluationCurrent);
		try {
			const input = configuration.runtime.configurationError || index.evaluationBlocked
				? {parseYaml: () => undefined} : captured();
			void Promise.resolve(input).then(async capturedInputs => {
				if (!evaluationCurrent()) return;
				const latest = this.inputs.configuration();
				// A presentation replacement is allowed to adopt its formatter without
				// repeating captured reference mathematics or the note evaluation.
				session.configuration = latest;
				await this.service.request({generation, runtime: session.configuration.runtime,
					preProcessors: configuration.runtime.preProcessors, syntax: {inlineEnabled: configuration.settings.enableInlineNumerals,
						triggers: index.triggers}, forceAllMetadata: configuration.settings.forceProcessAllFrontmatter,
					crossNoteReferencesEnabled: configuration.settings.enableCrossNoteReferences, ...capturedInputs});
			}).catch((error: unknown) => { if (evaluationCurrent()) this.fail(session, error); });
		} catch (error: unknown) { if (evaluationCurrent()) this.fail(session, error); }
	}

	private fail(session: Session, error: unknown): void {
		const generation = session.state.status === 'ready' ? session.state.snapshot.generation : session.state.generation;
		session.state = {status: 'error', generation, message: error instanceof Error ? error.message : String(error)};
		session.allowAutomatic = false; this.publish(session);
	}

	private publish(session: Session): void {
		for (const listener of [...session.listeners]) {
			if (session.listeners.has(listener)) {
				try { listener(); } catch (error: unknown) { console.error('Numerals snapshot subscriber failed', error); }
			}
		}
	}

	private generation(sourceId: string, sourcePath: string, sourceText: string, sourceRevision: number,
		metadata: number, dependency: number, configuration: SnapshotConfiguration): NoteGeneration {
		return {sourceId, sourcePath, sourceText, sourceRevision, metadataRevision: String(metadata),
			dependencyRevision: String(dependency), evaluationSettingsRevision: String(configuration.evaluationSettingsGeneration),
			runtimeGeneration: configuration.runtime.currencyGeneration};
	}

	private index(sourceId: string, revision: number, path: string, text: string, configuration: SnapshotConfiguration): NoteSourceIndex {
		const settings = configuration.settings;
		return indexNote({sourceId, revision, path, text}, {inlineEnabled: settings.enableInlineNumerals, triggers: [
			{trigger: settings.inlineResultTrigger, mode: 'result', renderStyle: 'plain'},
			{trigger: settings.inlineEquationTrigger, mode: 'equation', renderStyle: 'plain'},
			{trigger: settings.inlineTexResultTrigger, mode: 'result', renderStyle: 'tex'},
			{trigger: settings.inlineTexEquationTrigger, mode: 'equation', renderStyle: 'tex'},
		]});
	}
}
