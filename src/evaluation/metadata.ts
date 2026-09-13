import type { MathJsInstance } from 'mathjs';
import { filterAvailableProperties } from '../processing/crossNoteResolver';
import { removeCanonicalizedDuplicates } from '../processing/scope';
import { hasOwnProperty } from '../utils/hasOwnProperty';
import { copyMetadataValue } from './valueOwnership';

/** sourceId identifies the authoritative buffer, rather than only its file. */
export interface MetadataSource {
	readonly sourceId: string;
	readonly revision: string | number;
	readonly path?: string;
	readonly text: string;
}

export interface MetadataEntry {
	readonly key: string;
	/** Declarative source/value only: never a cached executable function. */
	readonly value: unknown;
	readonly provenance: 'native' | 'dataview';
}

/**
 * An adapter may supply this only when its provider actually captured this exact
 * buffer for this projection. File mtimes, events and index revisions cannot
 * establish that fact. The ordinary Dataview page API supplies no such proof.
 */
export interface ExactDataviewBufferEvidence extends MetadataSource {
	readonly kind: 'exact-buffer-capture';
	readonly projectionRevision: string | number;
}

/** These values invalidate work; they are deliberately never freshness proof. */
export interface MetadataInvalidationSignals {
	readonly mtimeMs?: number;
	readonly metadataEventRevision?: string | number;
	readonly indexRevision?: string | number;
}

export type DataviewMetadataInput =
	| { readonly status: 'absent' }
	| {
		readonly status: 'pending';
		readonly startedAtMs: number;
		readonly maxWaitMs?: number;
		readonly invalidation?: MetadataInvalidationSignals;
	}
	| {
		readonly status: 'projection';
		/** Default is a combined Dataview page. Never label a page as inline-only. */
		readonly origin?: 'page' | 'inline-fields';
		readonly revision: string | number;
		readonly metadata: Readonly<Record<string, unknown>>;
		readonly evidence?: ExactDataviewBufferEvidence;
		readonly invalidation?: MetadataInvalidationSignals;
	};

export interface MetadataFreshness {
	readonly status: 'native-ready' | 'pending' | 'unverified' | 'verified';
	readonly nativeReady: true;
	readonly projectionUsed: boolean;
	/** Metadata gate only. The caller must still verify every source/write guard. */
	readonly allowsAutomaticInsertion: boolean;
	readonly reason?: string;
	readonly retryAtMs?: number;
	readonly dataviewRevision?: string | number;
}

export interface CapturedNoteMetadata {
	/** Available immediately, regardless of Dataview presence or readiness. */
	readonly nativeEntries: readonly MetadataEntry[];
	/** Combined fields when a projection was explicitly supplied; native otherwise. */
	readonly entries: readonly MetadataEntry[];
	readonly freshness: MetadataFreshness;
	readonly warnings: readonly string[];
	/** Ambiguous or deleted cached YAML fields excluded from the projection. */
	readonly quarantinedFields: readonly string[];
	readonly frontmatter: {
		readonly status: 'absent' | 'parsed' | 'invalid' | 'unclosed';
		readonly start?: number;
		readonly end?: number;
	};
}

export interface CaptureNoteMetadataInput {
	readonly source: MetadataSource;
	readonly engine: MathJsInstance;
	readonly parseYaml: (yaml: string) => unknown;
	readonly forceAll?: boolean;
	readonly dataview?: DataviewMetadataInput;
	/** A monotonic clock reading, required to retain a pending state. */
	readonly nowMs?: number;
}

const DEFAULT_DATAVIEW_WAIT_MS = 250;
const MAX_DATAVIEW_WAIT_MS = 5000;

/**
 * Capture fresh declarative inputs, with no evaluation, timers or host reads.
 * Function-key declarations and expression strings are evaluated later in their
 * owning session. Repeated capture never merges an older populated scope.
 */
export function captureNoteMetadata(input: CaptureNoteMetadataInput): CapturedNoteMetadata {
	const warnings: string[] = [];
	const parsed = captureFrontmatter(input.source.text, input.parseYaml, warnings);
	const native = dataProperties(parsed.metadata, 'native', warnings);
	const nativeEntries = selectEntries(native, native, input, warnings);
	let freshness = getMetadataFreshness(input.source, input.dataview, input.nowMs);
	const quarantinedFields: string[] = [];
	let entries = nativeEntries;
	if (input.dataview?.status === 'projection') {
		const projected = selectProjection(input.dataview, native, parsed.region.status,
			freshness.status === 'verified', warnings, quarantinedFields);
		// Own-buffer YAML controls both values and opt-in, even for an exact page.
		const combined = { ...projected, ...native };
		entries = selectEntries(combined, native, input, warnings, new Set(Object.keys(projected)));
		freshness = { ...freshness, projectionUsed: entries.some(entry => entry.provenance === 'dataview') };
		if (quarantinedFields.length) freshness = {
			...freshness, status: 'unverified', allowsAutomaticInsertion: false,
			reason: 'Ambiguous or deleted YAML fields were quarantined from Dataview; native metadata remains available.',
		};
	}
	return { nativeEntries, entries, freshness, warnings: [...new Set(warnings)], quarantinedFields, frontmatter: parsed.region };
}

function selectProjection(projection: Extract<DataviewMetadataInput, { status: 'projection' }>,
	native: Record<string, unknown>, nativeStatus: CapturedNoteMetadata['frontmatter']['status'],
	exactBuffer: boolean, warnings: string[], quarantinedFields: string[]): Record<string, unknown> {
	const nativeNames = new Set(Object.keys(native).map(canonicalName));
	const cachedKeys = projection.origin === 'inline-fields' ? [] : cachedYamlKeys(projection.metadata);
	// Exact captured text can identify page YAML even when the legacy page API
	// omitted file.frontmatter. Invalid/open source YAML cannot supply that set.
	const knownYaml = cachedKeys ?? (exactBuffer && (nativeStatus === 'parsed' || nativeStatus === 'absent') ? Object.keys(native) : undefined);
	const cachedNames = knownYaml && new Set(knownYaml.map(canonicalName));
	const accepted: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const [key, value] of Object.entries(dataProperties(projection.metadata, 'dataview', warnings))) {
		if (key === 'numerals' || nativeNames.has(canonicalName(key))) continue;
		let reason: string | undefined;
		if (!cachedNames) {
			reason = 'page.file.frontmatter does not provide a complete YAML key set. Refresh Dataview or use separately captured inline fields.';
		} else if (cachedNames.has(canonicalName(key))) {
			reason = 'this cached YAML field is absent from the current source. Refresh Dataview or use native-only evaluation.';
		}
		if (reason) {
			quarantinedFields.push(key);
			warnings.push(`Dataview "${key}" quarantined: ${reason}`);
		} else accepted[key] = value;
	}
	return removeCanonicalizedDuplicates(accepted);
}

/** Matches the canonical-name cleanup used by the existing Dataview adapter. */
function canonicalName(key: string): string {
	return key.replace(/\s+/g, '-').replace(/[^0-9\p{L}_-]/gu, '').toLowerCase();
}

/**
 * Public page serialization provides raw YAML at file.frontmatter; older docs
 * describe a list of "key | value" strings. Read own data properties only.
 * A missing/invalid/ambiguous shape is not an empty, complete YAML key set.
 */
function cachedYamlKeys(page: Readonly<Record<string, unknown>>): string[] | undefined {
	const file = ownDataValue(page, 'file');
	const raw = ownDataValue(file, 'frontmatter');
	if (Array.isArray(raw)) {
		const keys: string[] = [];
		for (let index = 0; index < raw.length; index++) {
			const entry = ownDataValue(raw, String(index));
			if (typeof entry !== 'string') return undefined;
			const separator = entry.indexOf(' | ');
			if (separator < 0 || entry.indexOf(' | ', separator + 3) >= 0) return undefined;
			const key = entry.slice(0, separator);
			if (!key || key.trim() !== key) return undefined;
			keys.push(key);
		}
		return keys;
	}
	if (!raw || typeof raw !== 'object') return undefined;
	const prototype: unknown = Object.getPrototypeOf(raw);
	if (prototype !== null && prototype !== Object.prototype) return undefined;
	const keys = Object.getOwnPropertyNames(raw);
	if (keys.some(key => !hasDataProperty(raw, key))) return undefined;
	return keys;
}

function hasDataProperty(object: object, key: string): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(object, key);
	return descriptor !== undefined && 'value' in descriptor;
}

function ownDataValue(object: unknown, key: string): unknown {
	if (!object || typeof object !== 'object') return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(object, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

export function getMetadataFreshness(source: MetadataSource, dataview?: DataviewMetadataInput,
	nowMs?: number): MetadataFreshness {
	if (!dataview || dataview.status === 'absent') {
		return { status: 'native-ready', nativeReady: true, projectionUsed: false, allowsAutomaticInsertion: true };
	}
	if (dataview.status === 'pending') {
		const requestedWait = dataview.maxWaitMs ?? DEFAULT_DATAVIEW_WAIT_MS;
		const duration = Number.isFinite(requestedWait) ? Math.min(MAX_DATAVIEW_WAIT_MS, Math.max(0, requestedWait)) : 0;
		const deadline = dataview.startedAtMs + duration;
		if (Number.isFinite(nowMs) && Number.isFinite(dataview.startedAtMs) &&
			nowMs! >= dataview.startedAtMs && nowMs! < deadline) {
			return { status: 'pending', nativeReady: true, projectionUsed: false, allowsAutomaticInsertion: false,
				retryAtMs: deadline, reason: 'Dataview is pending; native metadata is available now.' };
		}
		return { status: 'unverified', nativeReady: true, projectionUsed: false, allowsAutomaticInsertion: false,
			reason: 'Dataview did not provide verified buffer metadata within the bounded wait; native metadata remains available.' };
	}
	const evidence = dataview.evidence;
	const verified = evidence?.kind === 'exact-buffer-capture' &&
		evidence.projectionRevision === dataview.revision && evidence.sourceId === source.sourceId &&
		evidence.revision === source.revision && evidence.path === source.path && evidence.text === source.text;
	return {
		status: verified ? 'verified' : 'unverified', nativeReady: true, projectionUsed: true,
		allowsAutomaticInsertion: verified, dataviewRevision: dataview.revision,
		...(verified ? {} : { reason: 'Dataview projection is not proven to match this exact buffer; automatic insertion is unavailable.' }),
	};
}

function selectEntries(metadata: Record<string, unknown>, native: Record<string, unknown>,
	input: CaptureNoteMetadataInput, warnings: string[], projectedKeys = new Set<string>()): MetadataEntry[] {
	// Avoid accepting Dataview's older or synthesized numerals opt-in policy.
	const controlled = { ...metadata };
	delete controlled.numerals;
	if (hasOwnProperty(native, 'numerals')) controlled.numerals = native.numerals;
	const selected = filterAvailableProperties(controlled, input.forceAll ?? false);
	const entries: MetadataEntry[] = [];
	for (const [key, rawValue] of Object.entries(selected)) {
		try {
			// Copy before selecting the final array item: hidden cached closures are
			// still rejected instead of being imported from provider-owned graphs.
			let value = copyMetadataValue(rawValue, input.engine);
			if (Array.isArray(value)) value = value[value.length - 1];
			entries.push({ key, value, provenance: projectedKeys.has(key) ? 'dataview' : 'native' });
		} catch (error: unknown) {
			warnings.push(`Metadata "${key}": ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return entries;
}

function dataProperties(value: Readonly<Record<string, unknown>>, origin: 'native' | 'dataview',
	warnings: string[]): Record<string, unknown> {
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(value)) {
		if (origin === 'dataview' && (key === 'file' || key === 'position')) continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !('value' in descriptor)) {
			warnings.push(`Metadata "${key}": accessor properties are not supported.`);
			continue;
		}
		result[key] = descriptor.value;
	}
	return result;
}

function captureFrontmatter(text: string, parseYaml: (yaml: string) => unknown, warnings: string[]): {
	metadata: Record<string, unknown>;
	region: CapturedNoteMetadata['frontmatter'];
} {
	// Delimiter compatibility for BOM/open headers remains an explicit host
	// extraction gate. Do not read cached frontmatter to fill missing source data.
	const opener = /^(?:\uFEFF)?---[\t ]*(?:\r\n|\n|\r|$)/.exec(text);
	if (!opener) return { metadata: {}, region: { status: 'absent' } };
	const closing = /^(?:---|\.\.\.)[\t ]*(?=\r?$)/gm;
	closing.lastIndex = opener[0].length;
	const match = closing.exec(text);
	if (!match) {
		warnings.push('Frontmatter is unclosed; metadata from an older source revision is not used.');
		return { metadata: {}, region: { status: 'unclosed', start: 0, end: text.length } };
	}
	const region = { start: 0, end: match.index + match[0].length };
	try {
		const parsed = parseYaml(text.slice(opener[0].length, match.index));
		if (parsed === null || parsed === undefined) return { metadata: {}, region: { ...region, status: 'parsed' } };
		if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a YAML property mapping.');
		return { metadata: parsed as Record<string, unknown>, region: { ...region, status: 'parsed' } };
	} catch (error: unknown) {
		warnings.push(`Frontmatter: ${error instanceof Error ? error.message : String(error)}`);
		return { metadata: {}, region: { ...region, status: 'invalid' } };
	}
}
