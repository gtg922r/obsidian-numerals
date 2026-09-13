import type { NumeralsScope } from '../numerals.types';
import { isVerifiedProvenance, mergeProvenance, VERIFIED_PROVENANCE, type ValueProvenance } from './provenance';

export type { ValueProvenance } from './provenance';

export interface SessionProvenanceOptions {
	readonly seeds?: ReadonlyMap<string, ValueProvenance>;
	/** Default: every object/function is opaque. Only narrow this with runtime evidence. */
	readonly isOpaqueValue?: (value: unknown) => boolean;
	/** Public-runtime traversal for native containers, e.g. Matrix.forEach. [] means no child values. */
	readonly children?: (value: object) => readonly unknown[] | undefined;
}

/** Identity of one complete, private evaluation. No populated scope crosses it. */
export interface EvaluationGeneration {
	readonly sourceRevision: string;
	readonly metadataGeneration: string;
	readonly runtimeGeneration: number;
}

/** Evaluator-owned state; never expose an environment through a rendered snapshot. */
export interface CalculationEnvironment {
	readonly calculationId: string;
	readonly localFrameId: string;
	/** Defining-calculation references, composed with scope by the reference adapter. */
	readonly bindings: ReadonlyMap<string, unknown>;
	readonly scope: NumeralsScope;
}

export interface RowTransaction {
	/** Available after commit/discard; returned arrays never alias mutable state. */
	readonly provenance: ValueProvenance;
	/** Supply the raw result so returned closures/collections keep captured provenance. */
	commit(result?: unknown): void;
	discard(): void;
}

export interface RowTransactionOptions {
	/** Ordinary metadata is reinitialized locally, but dollar seeds publish only once. */
	readonly publishGlobals?: boolean;
}

type BindingFrame = Map<string, unknown>;
type BindingChange = { readonly key: string } & (
	{ readonly kind: 'set'; readonly value: unknown; readonly provenance?: ValueProvenance } |
	{ readonly kind: 'delete' }
);

interface FrameOverlay {
	/** Operations preserve deletion/reinsertion order without cloning the native heap. */
	readonly changes: BindingChange[];
	readonly latest: Map<string, BindingChange>;
}

interface ActiveRow {
	readonly overlays: Map<BindingFrame, FrameOverlay>;
	provenance: ValueProvenance;
	opaqueRead: boolean;
}

interface ScopeAccess {
	assertLive(): void;
	get(key: string): unknown;
	has(key: string): boolean;
	set(key: string, value: unknown): void;
	delete(key: string): boolean;
	keys(): string[];
}

/**
 * All Map operations use the same backing frames. In particular, inherited Map
 * iteration must not silently enumerate the empty Map used for subclass branding.
 */
class CalculationScope extends Map<string, unknown> {
	constructor(private readonly access: ScopeAccess) { super(); }

	override get(key: string): unknown { return this.access.get(key); }
	override has(key: string): boolean { return this.access.has(key); }
	override set(key: string, value: unknown): this {
		this.access.set(key, value);
		return this;
	}
	override delete(key: string): boolean { return this.access.delete(key); }
	override clear(): void {
		this.access.assertLive();
		for (const key of this.access.keys()) this.access.delete(key);
	}
	override get size(): number { return this.access.keys().length; }
	override *keys(): MapIterator<string> {
		for (const key of this.access.keys()) {
			this.access.assertLive();
			yield key;
		}
		this.access.assertLive();
	}
	override *entries(): MapIterator<[string, unknown]> {
		for (const key of this.keys()) yield [key, this.get(key)];
	}
	override *values(): MapIterator<unknown> {
		for (const key of this.keys()) yield this.get(key);
	}
	override [Symbol.iterator](): MapIterator<[string, unknown]> { return this.entries(); }
	override forEach(callback: (value: unknown, key: string, map: Map<string, unknown>) => void, thisArg?: unknown): void {
		for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
	}
}

/**
 * One source generation's binding store. Stable scopes retain defining ordinary
 * locals while all dollar names route to the current note-global frame.
 *
 * A synchronous row stages bindings in every environment reached by native
 * mathjs functions. Objects, closures and runtime state are deliberately not
 * cloned: discard rolls back bindings, not opaque mutation or createUnit.
 * Callers must detach external seeds and reference values before passing them
 * here, and must separately detach results before publishing them.
 */
export class EvaluationSession {
	readonly generation: EvaluationGeneration;
	private readonly globals: BindingFrame;
	private readonly environments = new Map<string, CalculationEnvironment>();
	private readonly localFrames = new Set<BindingFrame>();
	private readonly environmentFrames = new Map<CalculationEnvironment, BindingFrame>();
	private readonly bindingProvenance = new Map<BindingFrame, Map<string, ValueProvenance>>();
	private readonly identities = new Map<object, ValueProvenance>();
	private readonly isOpaqueValue: (value: unknown) => boolean;
	private readonly children: (value: object) => readonly unknown[] | undefined;
	private opaqueUncertainty: ValueProvenance = VERIFIED_PROVENANCE;
	private activeRow: ActiveRow | undefined;
	private retired = false;

	constructor(generation: EvaluationGeneration, dollarSeeds: ReadonlyMap<string, unknown> = new Map(),
		provenance: SessionProvenanceOptions = {}) {
		for (const key of dollarSeeds.keys()) {
			if (!isGlobal(key)) throw new Error('Session seeds must be dollar-prefixed globals');
		}
		this.generation = Object.freeze({ ...generation });
		this.globals = new Map(dollarSeeds);
		this.isOpaqueValue = provenance.isOpaqueValue ?? isIdentity;
		this.children = provenance.children ?? (() => undefined);
		this.seedProvenance(this.globals, provenance.seeds);
	}

	get isRetired(): boolean { return this.retired; }

	/** Seeds and references are copied as binding tables, retaining private value identity. */
	createEnvironment(
		calculationId: string,
		localSeeds: ReadonlyMap<string, unknown> = new Map(),
		bindings: ReadonlyMap<string, unknown> = new Map(),
		seedProvenance: ReadonlyMap<string, ValueProvenance> = new Map(),
	): CalculationEnvironment {
		this.assertLive();
		if (this.activeRow) throw new Error('Cannot create a calculation environment during a row');
		if (this.environments.has(calculationId)) throw new Error('Calculation environment already exists');
		for (const key of localSeeds.keys()) {
			if (isGlobal(key)) throw new Error('Calculation seeds must be ordinary local names');
		}
		const frame = new Map(localSeeds);
		this.seedProvenance(frame, seedProvenance);
		const environment: CalculationEnvironment = Object.freeze({
			calculationId,
			localFrameId: `local:${this.environments.size}`,
			bindings: new Map(bindings),
			scope: new CalculationScope({
				assertLive: () => this.assertLive(),
				get: key => this.get(this.frameFor(frame, key), key),
				has: key => this.has(this.frameFor(frame, key), key),
				set: (key, value) => this.stage(this.frameFor(frame, key), { key, kind: 'set', value }),
				delete: key => this.delete(this.frameFor(frame, key), key),
				keys: () => [...this.visibleFrame(this.globals).keys(), ...this.visibleFrame(frame).keys()],
			}),
		});
		this.localFrames.add(frame);
		this.environmentFrames.set(environment, frame);
		this.environments.set(calculationId, environment);
		return environment;
	}

	/** No await or nested row is permitted between beginRow and commit/discard. */
	beginRow(environment: CalculationEnvironment, options: RowTransactionOptions = {}): RowTransaction {
		this.assertEnvironment(environment);
		if (this.activeRow) throw new Error('An evaluation row is already active');
		const publishGlobals = options.publishGlobals !== false;
		const row: ActiveRow = { overlays: new Map(), provenance: VERIFIED_PROVENANCE, opaqueRead: false };
		this.activeRow = row;
		return Object.freeze({
			get provenance() { return row.provenance; },
			commit: (result?: unknown) => {
				this.assertRow(row);
				// A result can itself retain an older identity, even if the engine did
				// not retrieve that identity through a tracked free-variable lookup.
				row.provenance = mergeProvenance(row.provenance, this.identityProvenance(result));
				this.rememberIdentity(result, row.provenance);
				for (const [frame, overlay] of row.overlays) {
					if (frame === this.globals && !publishGlobals) continue;
					const provenances = this.bindingProvenance.get(frame)!;
					for (const change of overlay.changes) {
						applyChange(frame, change);
						if (change.kind === 'delete') provenances.delete(change.key);
						else {
							const provenance = mergeProvenance(change.provenance ?? row.provenance, this.identityProvenance(change.value));
							provenances.set(change.key, provenance);
							this.rememberIdentity(change.value, provenance);
						}
					}
				}
				this.activeRow = undefined;
				row.overlays.clear();
			},
			discard: () => {
				this.assertRow(row);
				this.activeRow = undefined;
				row.overlays.clear();
			},
		});
	}

	/** D's reference adapter calls this only when it actually lends an input. */
	recordInput(provenance: ValueProvenance, value?: unknown): void {
		const row = this.requireRow();
		row.provenance = mergeProvenance(row.provenance, provenance, this.identityProvenance(value));
		if (isIdentity(value) && this.isOpaqueValue(value)) row.opaqueRead = true;
		this.rememberIdentity(value, provenance);
		this.invalidateOpaqueProvenance(row);
	}

	/**
	 * Mark evaluator-recognized opaque engine operations. This cannot discover
	 * createUnit/import/evaluate calls or future registry-dependent reads itself.
	 */
	recordOpaqueEffect(): void {
		const row = this.requireRow();
		row.opaqueRead = true;
		row.provenance = mergeProvenance(row.provenance, { unverified: [], ambiguous: true });
		this.invalidateOpaqueProvenance(row);
	}

	/** Stage a detached @prev/@total input without counting an unused borrow as a read. */
	borrow(environment: CalculationEnvironment, key: string, value: unknown, provenance: ValueProvenance): void {
		this.assertEnvironment(environment);
		const frame = this.frameFor(this.environmentFrames.get(environment)!, key);
		this.stage(frame, { key, kind: 'set', value,
			provenance: mergeProvenance(provenance, this.identityProvenance(value, true)) });
	}

	/** Private evaluator copy, including staged bindings. Values are NOT detached. */
	copyBindings(environment: CalculationEnvironment): Map<string, unknown> {
		this.assertEnvironment(environment);
		// An orchestration copy is not a mathematical read of every visible input.
		return new Map([...this.visibleFrame(this.globals), ...this.visibleFrame(this.environmentFrames.get(environment)!)]);
	}

	/** Private evaluator copy, including staged bindings. Values are NOT detached. */
	copyGlobals(): Map<string, unknown> { return this.visibleFrame(this.globals); }

	/** Drops ownership and guards scope access; it cannot revoke a leaked opaque closure. */
	retire(): void {
		if (this.retired) return;
		this.retired = true;
		this.activeRow?.overlays.clear();
		this.activeRow = undefined;
		this.globals.clear();
		for (const frame of this.localFrames) frame.clear();
		this.localFrames.clear();
		this.environmentFrames.clear();
		this.bindingProvenance.clear();
		this.identities.clear();
		this.opaqueUncertainty = VERIFIED_PROVENANCE;
		this.environments.clear();
	}

	private assertLive(): void {
		if (this.retired) throw new Error('Evaluation session is retired');
	}

	private assertEnvironment(environment: CalculationEnvironment): void {
		this.assertLive();
		if (this.environments.get(environment.calculationId) !== environment) {
			throw new Error('Calculation environment belongs to another evaluation session');
		}
	}

	private assertRow(row: ActiveRow): void {
		this.assertLive();
		if (this.activeRow !== row) throw new Error('Evaluation row is no longer active');
	}

	private requireRow(): ActiveRow {
		this.assertLive();
		if (!this.activeRow) throw new Error('Provenance recording requires an active evaluation row');
		return this.activeRow;
	}

	private frameFor(localFrame: BindingFrame, key: string): BindingFrame {
		return isGlobal(key) ? this.globals : localFrame;
	}

	private get(frame: BindingFrame, key: string): unknown {
		this.assertLive();
		const change = this.activeRow?.overlays.get(frame)?.latest.get(key);
		const value = change ? (change.kind === 'set' ? change.value : undefined) : frame.get(key);
		if (this.activeRow && (!change || change.kind === 'set')) {
			const provenance = change?.kind === 'set'
				? change.provenance ? mergeProvenance(change.provenance, this.identityProvenance(value, true)) : this.activeRow.provenance
				: this.bindingProvenance.get(frame)?.get(key) ?? VERIFIED_PROVENANCE;
			this.recordInput(provenance, value);
		}
		return value;
	}

	private has(frame: BindingFrame, key: string): boolean {
		this.assertLive();
		const change = this.activeRow?.overlays.get(frame)?.latest.get(key);
		return change ? change.kind === 'set' : frame.has(key);
	}

	private stage(frame: BindingFrame, change: BindingChange): void {
		this.assertLive();
		if (!this.activeRow) throw new Error('Scope binding changes require an active evaluation row');
		let overlay = this.activeRow.overlays.get(frame);
		if (!overlay) {
			overlay = { changes: [], latest: new Map() };
			this.activeRow.overlays.set(frame, overlay);
		}
		overlay.changes.push(change);
		overlay.latest.set(change.key, change);
	}

	private delete(frame: BindingFrame, key: string): boolean {
		const existed = this.has(frame, key);
		this.stage(frame, { key, kind: 'delete' });
		return existed;
	}

	private visibleFrame(frame: BindingFrame): BindingFrame {
		this.assertLive();
		const visible = new Map(frame);
		for (const change of this.activeRow?.overlays.get(frame)?.changes ?? []) applyChange(visible, change);
		return visible;
	}

	private seedProvenance(frame: BindingFrame, seeds?: ReadonlyMap<string, ValueProvenance>): void {
		const bindings = new Map<string, ValueProvenance>();
		for (const [key, value] of frame) {
			const provenance = mergeProvenance(seeds?.get(key) ?? VERIFIED_PROVENANCE);
			bindings.set(key, provenance);
			this.rememberIdentity(value, provenance);
		}
		this.bindingProvenance.set(frame, bindings);
	}

	private identityProvenance(value: unknown, borrowed = false, seen = new Set<object>()): ValueProvenance {
		if (!isIdentity(value) || seen.has(value)) return VERIFIED_PROVENANCE;
		seen.add(value);
		let provenance = this.identities.get(value) ?? VERIFIED_PROVENANCE;
		const children = this.childValues(value);
		if (children) {
			for (const child of children) provenance = mergeProvenance(provenance, this.identityProvenance(child, borrowed, seen));
		} else if (borrowed && !this.identities.has(value) && this.isOpaqueValue(value)) {
			// A new wrapper may retain an invalidated old closure. When no public
			// traversal is supplied, do not certify that opaque borrowed storage.
			provenance = mergeProvenance(provenance, this.opaqueUncertainty);
		}
		return provenance;
	}

	private childValues(value: object): readonly unknown[] | undefined {
		if (typeof value === 'function') return undefined;
		const prototype: unknown = Object.getPrototypeOf(value);
		if (Array.isArray(value) || prototype === Object.prototype || prototype === null) {
			const children: unknown[] = [];
			for (const key of Object.keys(value)) {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (!descriptor || !('value' in descriptor)) return undefined;
				children.push(descriptor.value);
			}
			return children;
		}
		return this.children(value);
	}

	private rememberIdentity(value: unknown, provenance: ValueProvenance): void {
		if (isIdentity(value)) this.identities.set(value, mergeProvenance(this.identityProvenance(value), provenance));
	}

	private invalidateOpaqueProvenance(row: ActiveRow): void {
		if (!row.opaqueRead || isVerifiedProvenance(row.provenance)) return;
		// Native code may mutate shared captured storage without scope.set, even
		// in a failed row. Conservatively retain uncertainty on every known opaque
		// identity; never transfer it to unrelated primitive bindings/results.
		row.provenance = mergeProvenance(row.provenance, { unverified: [], ambiguous: true });
		this.opaqueUncertainty = mergeProvenance(this.opaqueUncertainty, row.provenance);
		for (const [value, provenance] of this.identities) {
			if (this.isOpaqueValue(value)) this.identities.set(value, mergeProvenance(provenance, row.provenance));
		}
	}
}

function isGlobal(key: string): boolean { return key.startsWith('$'); }
function isIdentity(value: unknown): value is object {
	return typeof value === 'function' || (value !== null && typeof value === 'object');
}

function applyChange(frame: BindingFrame, change: BindingChange): void {
	if (change.kind === 'set') frame.set(change.key, change.value);
	else frame.delete(change.key);
}
