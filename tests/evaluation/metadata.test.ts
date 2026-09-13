import { all, create } from 'mathjs';
import {
	captureNoteMetadata, getMetadataFreshness,
	type CaptureNoteMetadataInput, type DataviewMetadataInput,
	type ExactDataviewBufferEvidence, type MetadataSource,
} from '../../src/evaluation/metadata';

const { load: parseYaml } = jest.requireActual<{ load: (text: string) => unknown }>('js-yaml');
const engine = create(all);

function source(text: string, revision: string | number = 1): MetadataSource {
	return { sourceId: 'editor-A', path: 'Costs.md', revision, text };
}

function capture(text: string, options: Partial<CaptureNoteMetadataInput> = {}) {
	return captureNoteMetadata({ source: source(text), engine, parseYaml, ...options });
}

function values(result: ReturnType<typeof capture>, native = false): Record<string, unknown> {
	return Object.fromEntries((native ? result.nativeEntries : result.entries).map(entry => [entry.key, entry.value]));
}

describe('authoritative note metadata capture', () => {
	it('parses the current full buffer, then removes obsolete fields in the next revision', () => {
		const first = capture('---\nnumerals: all\nprice: 2\n$old: 10\n---\n`#: price`');
		const nextSource = source('---\nnumerals: all\nprice: 7\n---\n`#: price`', 2);
		const next = captureNoteMetadata({ source: nextSource, engine, parseYaml });
		expect(values(first)).toEqual({ price: 2, $old: 10 });
		expect(values(next)).toEqual({ price: 7 });
		expect(first.freshness.status).toBe('native-ready');
		expect(next.freshness.allowsAutomaticInsertion).toBe(true);
	});

	it('passes only frontmatter YAML to the injected parser, preserving CRLF and UTF-16 offsets', () => {
		const text = '\uFEFF---\r\nnumerals: all\r\nlabel: "😀"\r\n---\r\nBody';
		const parser = jest.fn(parseYaml);
		const result = capture(text, { parseYaml: parser });
		expect(parser).toHaveBeenCalledWith('numerals: all\r\nlabel: "😀"\r\n');
		expect(values(result)).toEqual({ label: '😀' });
		expect(result.frontmatter).toEqual({ status: 'parsed', start: 0, end: text.lastIndexOf('---') + 3 });
	});

	it.each([
		['none', false, { $global: 5 }],
		['all', false, { x: 1, y: 2, $global: 5 }],
		['x', false, { x: 1, $global: 5 }],
		['[x, y]', false, { x: 1, y: 2, $global: 5 }],
		[undefined, false, { $global: 5 }],
		[undefined, true, { x: 1, y: 2, $global: 5 }],
		['none', true, { $global: 5 }],
	] as const)('keeps opt-in %s and forceAll %s semantics', (policy, forceAll, expected) => {
		const policyLine = policy === undefined ? '' : `numerals: ${policy}\n`;
		expect(values(capture(`---\n${policyLine}x: 1\ny: 2\n$global: 5\n---`, { forceAll }))).toEqual(expected);
	});

	it('retains unevaluated function declarations and expression strings', () => {
		const result = capture('---\nnumerals: all\n$f(x): "x + $rate"\n$rate: "2 + 3"\n---');
		expect(values(result)).toEqual({ '$f(x)': 'x + $rate', $rate: '2 + 3' });
		expect(result.entries.every(entry => typeof entry.value !== 'function')).toBe(true);
	});

	it('uses the last native array entry without flattening nested array values', () => {
		const result = capture('---\nnumerals: all\nrate: [1, 3]\nrows: [[1, 2], [3, 4]]\nempty: []\n---');
		expect(values(result)).toEqual({ rate: 3, rows: [3, 4], empty: undefined });
	});

	it('treats non-leading YAML, missing frontmatter, and unclosed frontmatter without cached fallback', () => {
		const parser = jest.fn(parseYaml);
		expect(capture('Text\n---\nnumerals: all\nx: 2\n---', { parseYaml: parser }).frontmatter.status).toBe('absent');
		expect(capture('No properties', { parseYaml: parser }).entries).toEqual([]);
		const unclosed = capture('---\nnumerals: all\n$gone: 4', { parseYaml: parser });
		expect(unclosed.frontmatter.status).toBe('unclosed');
		expect(unclosed.entries).toEqual([]);
		expect(capture('---', { parseYaml: parser }).frontmatter.status).toBe('unclosed');
		expect(parser).not.toHaveBeenCalled();
	});

	it('reports malformed/nonmapping frontmatter and still permits native calculation without seeds', () => {
		const invalid = capture('---\nx: [broken\n---');
		expect(invalid.frontmatter.status).toBe('invalid');
		expect(invalid.warnings[0]).toMatch(/^Frontmatter:/);
		expect(invalid.nativeEntries).toEqual([]);
		expect(invalid.freshness.nativeReady).toBe(true);
		expect(capture('---\n- a\n- b\n---').frontmatter.status).toBe('invalid');
	});

	it('supports empty YAML and the declared YAML closing-marker policy', () => {
		expect(capture('---\n---').frontmatter.status).toBe('parsed');
		expect(values(capture('---\nnumerals: all\nx: 2\n...\nBody'))).toEqual({ x: 2 });
	});
});

describe('Dataview fields and detached declarative inputs', () => {
	it('preserves native values, removes canonical aliases, and uses repeated inline fields’ last array values', () => {
		const result = capture('---\nnumerals: all\nprice: 1\nlocal: 6\n---', {
			dataview: { status: 'projection', revision: 4, metadata: {
				price: [1, 4], 'f(x)': 'x + 2', fx: 'x + 2', '$g(x)': 'x * 3', gx: 'x * 3',
				'Hourly Rate': [5, 10], 'hourly-rate': [5, 10], file: { frontmatter: { price: 1, local: 6 } }, position: {},
			} },
		});
		expect(values(result)).toEqual({ price: 1, local: 6, 'f(x)': 'x + 2', '$g(x)': 'x * 3', 'Hourly Rate': 10 });
		expect(values(result, true)).toEqual({ price: 1, local: 6 });
		expect(result.entries.find(entry => entry.key === 'price')?.provenance).toBe('native');
		expect(result.entries.find(entry => entry.key === 'local')?.provenance).toBe('native');
		expect(result.freshness.status).toBe('unverified');
	});

	it('uses the current buffer’s opt-in when a stale projection claims all or none', () => {
		const metadata = { numerals: 'all', price: 40, hidden: 90, $global: 8, file: { frontmatter: {} } };
		expect(values(capture('---\nnumerals: price\nprice: 2\n---', {
			dataview: { status: 'projection', revision: 2, metadata },
		}))).toEqual({ price: 2, $global: 8 });
		expect(values(capture('No frontmatter', {
			dataview: { status: 'projection', revision: 2, metadata },
		}))).toEqual({ $global: 8 });
		expect(values(capture('---\nnumerals: all\n---', {
			dataview: { status: 'projection', revision: 3, metadata: { ...metadata, numerals: 'none' } },
		}))).toEqual({ price: 40, hidden: 90, $global: 8 });
	});

	it('detaches nested values and mathjs types from providers and from native fallback entries', () => {
		const property = { nested: { cost: 2 }, matrix: engine.matrix([[1, 2]]), unit: engine.unit('3 cm') };
		const result = capture('---\nnumerals: all\n---', {
			parseYaml: () => ({ numerals: 'all', property }),
			dataview: { status: 'projection', origin: 'inline-fields', revision: 1, metadata: { extra: 5 } },
		});
		const output = values(result).property as typeof property;
		output.nested.cost = 99;
		output.matrix.set([0, 0], 99);
		output.unit.value = 99;
		expect(property.nested.cost).toBe(2);
		expect(property.matrix.get([0, 0])).toBe(1);
		expect(property.unit.toNumber('cm')).toBeCloseTo(3);
		expect((values(result, true).property as typeof property).nested.cost).toBe(2);
	});

	it('rejects cached executable functions even inside collections, preserving other fields', () => {
		const cached = () => 2;
		const functionMatrix = engine.matrix([0]);
		functionMatrix.set([0], cached);
		const result = capture('---\nnumerals: all\n---', {
			dataview: { status: 'projection', origin: 'inline-fields', revision: 1, metadata: {
				bad: cached, nested: { f: cached }, repeated: [cached, 5], matrix: functionMatrix, good: 7,
			} },
		});
		expect(values(result)).toEqual({ good: 7 });
		expect(result.warnings).toHaveLength(4);
		expect(result.warnings.every(warning => warning.includes('executable function'))).toBe(true);
	});

	it('does not invoke external metadata accessors', () => {
		const accessor = jest.fn(() => 7);
		const metadata: Record<string, unknown> = { good: 3 };
		Object.defineProperty(metadata, 'bad', { enumerable: true, get: accessor });
		const result = capture('---\nnumerals: all\n---', { dataview: { status: 'projection', origin: 'inline-fields', revision: 1, metadata } });
		expect(values(result)).toEqual({ good: 3 });
		expect(accessor).not.toHaveBeenCalled();
		expect(result.warnings[0]).toContain('accessor');
	});
});

describe('Dataview page provenance and YAML quarantine', () => {
	it('never resurrects a deleted YAML dollar field or its canonical alias from a cached page', () => {
		const result = capture('---\nnumerals: all\ncurrent: 2\n---', {
			dataview: { status: 'projection', revision: 1, metadata: {
				$old: 10, old: 10, '$f(x)': 'x + 1', fx: 'x + 1', inline: [1, 3],
				file: { frontmatter: { $old: 10, '$f(x)': 'x + 1' } },
			} },
		});
		expect(values(result)).toEqual({ current: 2, inline: 3 });
		expect(result.quarantinedFields).toEqual(['$old', 'old', '$f(x)', 'fx']);
		expect(result.warnings).toHaveLength(4);
		expect(result.warnings[0]).toContain('"$old"');
		expect(result.warnings[0]).toContain('Refresh Dataview');
		expect(result.freshness).toMatchObject({ status: 'unverified', allowsAutomaticInsertion: false, projectionUsed: true });
	});

	it('keeps the current YAML field and suppresses all of its cached canonical variants', () => {
		const result = capture('---\nnumerals: all\n"$Hourly Rate": 5\n---', {
			dataview: { status: 'projection', revision: 1, metadata: {
				'$Hourly Rate': [4, 99], 'hourly-rate': 99, '$hourly-rate': 99,
				file: { frontmatter: { '$Hourly Rate': 4 } },
			} },
		});
		expect(values(result)).toEqual({ '$Hourly Rate': 5 });
		expect(result.entries[0].provenance).toBe('native');
	});

	it('quarantines the whole ambiguous overlay when a default page lacks its YAML key provenance', () => {
		const result = capture('---\nnumerals: all\nprice: 2\n---', {
			dataview: { status: 'projection', revision: 1, metadata: { price: 90, $old: 10, extra: 8 } },
		});
		expect(values(result)).toEqual({ price: 2 });
		expect(result.quarantinedFields).toEqual(['$old', 'extra']);
		expect(result.warnings.every(warning => warning.includes('complete YAML key set'))).toBe(true);
		expect(result.freshness).toMatchObject({ status: 'unverified', projectionUsed: false, allowsAutomaticInsertion: false });
	});

	it.each([{ frontmatter: {} }, { frontmatter: [] }])('distinguishes known empty YAML provenance %j from missing provenance', ({ frontmatter }) => {
		const known = capture('No frontmatter', { dataview: {
			status: 'projection', revision: 1, metadata: { $inline: [1, 7], file: { frontmatter } },
		} });
		const unknown = capture('No frontmatter', { dataview: {
			status: 'projection', revision: 1, metadata: { $inline: [1, 7], file: {} },
		} });
		expect(values(known)).toEqual({ $inline: 7 });
		expect(known.quarantinedFields).toEqual([]);
		expect(values(unknown)).toEqual({});
		expect(unknown.quarantinedFields).toEqual(['$inline']);
	});

	it('reads complete raw mappings with null prototypes without reading their values', () => {
		const frontmatter: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		frontmatter.$old = 5;
		const result = capture('No YAML', { dataview: {
			status: 'projection', revision: 1, metadata: { $old: 5, $inline: 8, file: { frontmatter } },
		} });
		expect(values(result)).toEqual({ $inline: 8 });
		expect(result.quarantinedFields).toEqual(['$old']);
	});

	it('reads the documented legacy key/value list and quarantines its deleted keys', () => {
		const result = capture('---\nnumerals: all\nprice: 2\n---', { dataview: {
			status: 'projection', revision: 1, metadata: { price: 40, $old: 5, old: 5, inline: [1, 9],
				file: { frontmatter: ['price | 40', '$old | 5'] } },
		} });
		expect(values(result)).toEqual({ price: 2, inline: 9 });
		expect(result.quarantinedFields).toEqual(['$old', 'old']);
	});

	it.each([null, undefined, 'key | 1', new Date(0), ['key | 1', 7], ['missing separator'],
		['ambiguous | key | value'], [' key | value'], [' | value']].map(frontmatter => ({ frontmatter })))('rejects an incomplete or ambiguous provenance shape %j', ({ frontmatter }) => {
		const result = capture('No YAML', { dataview: {
			status: 'projection', revision: 1, metadata: { $ambiguous: 5, file: { frontmatter } },
		} });
		expect(values(result)).toEqual({});
		expect(result.quarantinedFields).toEqual(['$ambiguous']);
	});

	it('never invokes getters on file, frontmatter, legacy list items, or YAML key values', () => {
		const accessor = jest.fn(() => ({}));
		const fileGetter = Object.defineProperty({ $inline: 8 }, 'file', { enumerable: true, get: accessor });
		const frontmatterGetter = { $inline: 8, file: Object.defineProperty({}, 'frontmatter', { get: accessor }) };
		const legacy = Object.defineProperty(['key | 2'], '0', { get: accessor });
		const raw = Object.defineProperty({}, '$key', { enumerable: true, get: accessor });
		for (const metadata of [fileGetter, frontmatterGetter, { $inline: 8, file: { frontmatter: legacy } },
			{ $inline: 8, file: { frontmatter: raw } }]) {
			const result = capture('No YAML', { dataview: { status: 'projection', revision: 1, metadata } });
			expect(values(result)).toEqual({});
			expect(result.quarantinedFields).toEqual(['$inline']);
		}
		expect(accessor).not.toHaveBeenCalled();
	});

	it('does not accept an inherited frontmatter field as complete provenance', () => {
		const file = Object.create({ frontmatter: {} }) as Record<string, unknown>;
		const result = capture('No YAML', { dataview: { status: 'projection', revision: 1, metadata: { $old: 4, file } } });
		expect(values(result)).toEqual({});
		expect(result.quarantinedFields).toEqual(['$old']);
	});

	it('permits separately captured inline fields while keeping YAML authoritative and insertion unavailable', () => {
		const result = capture('---\nnumerals: all\nprice: 2\n---', { dataview: {
			status: 'projection', origin: 'inline-fields', revision: 1, metadata: { price: [1, 90], $inline: [2, 6], ordinary: [1, 3] },
		} });
		expect(values(result)).toEqual({ price: 2, $inline: 6, ordinary: 3 });
		expect(result.quarantinedFields).toEqual([]);
		expect(result.freshness).toMatchObject({ status: 'unverified', allowsAutomaticInsertion: false, projectionUsed: true });
	});

	it('can use exact buffer evidence for an otherwise known page without allowing it to overwrite YAML', () => {
		const buffer = source('---\nnumerals: all\nprice: 2\n---');
		const evidence: ExactDataviewBufferEvidence = { ...buffer, kind: 'exact-buffer-capture', projectionRevision: 1 };
		const result = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview: {
			status: 'projection', revision: 1, evidence, metadata: { price: [1, 90], extra: [1, 4] },
		} });
		expect(values(result)).toEqual({ price: 2, extra: 4 });
		expect(result.quarantinedFields).toEqual([]);
		expect(result.freshness).toMatchObject({ status: 'verified', allowsAutomaticInsertion: true });
	});

	it('downgrades contradictory exact evidence when a page still contains deleted cached YAML fields', () => {
		const buffer = source('No YAML');
		const evidence: ExactDataviewBufferEvidence = { ...buffer, kind: 'exact-buffer-capture', projectionRevision: 1 };
		const result = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview: {
			status: 'projection', revision: 1, evidence, metadata: { $old: 5, file: { frontmatter: { $old: 5 } } },
		} });
		expect(values(result)).toEqual({});
		expect(result.freshness).toMatchObject({ status: 'unverified', projectionUsed: false, allowsAutomaticInsertion: false });
	});
});

describe('metadata buffer freshness', () => {
	const buffer = source('---\nnumerals: all\nprice: 7\n---', 'edit-7');
	const evidence: ExactDataviewBufferEvidence = { ...buffer, kind: 'exact-buffer-capture', projectionRevision: 'dv-7' };
	const projection: DataviewMetadataInput = { status: 'projection', revision: 'dv-7', metadata: { price: 7 }, evidence };

	it('is immediately native-ready when Dataview is absent', () => {
		expect(getMetadataFreshness(buffer)).toEqual({ status: 'native-ready', nativeReady: true, projectionUsed: false, allowsAutomaticInsertion: true });
		expect(getMetadataFreshness(buffer, { status: 'absent' }).status).toBe('native-ready');
	});

	it('keeps native inputs available during the bounded wait and after timeout', () => {
		const dataview: DataviewMetadataInput = { status: 'pending', startedAtMs: 100, maxWaitMs: 250 };
		const pending = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview, nowMs: 349 });
		const expired = captureNoteMetadata({ source: buffer, engine, parseYaml, dataview, nowMs: 350 });
		expect(pending.freshness.status).toBe('pending');
		expect(pending.freshness.retryAtMs).toBe(350);
		expect(expired.freshness.status).toBe('unverified');
		expect(values(pending)).toEqual({ price: 7 });
		expect(values(expired)).toEqual({ price: 7 });
		expect(expired.freshness.allowsAutomaticInsertion).toBe(false);
	});

	it('never waits indefinitely on invalid clocks or an excessive requested wait', () => {
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 0 }).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: NaN }, 1).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 100 }, 99).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 0, maxWaitMs: Infinity }, 1).status).toBe('unverified');
		expect(getMetadataFreshness(buffer, { status: 'pending', startedAtMs: 0, maxWaitMs: 100000 }, 5000).status).toBe('unverified');
	});

	it('does not treat matching mtime/event/index revision signals as exact buffer proof', () => {
		expect(getMetadataFreshness(buffer, {
			status: 'projection', revision: buffer.revision, metadata: { price: 7 },
			invalidation: { mtimeMs: 7, metadataEventRevision: buffer.revision, indexRevision: buffer.revision },
		}, 7)).toMatchObject({ status: 'unverified', projectionUsed: true, allowsAutomaticInsertion: false });
	});

	it('accepts an explicitly attested exact capture and checks every source and projection identity', () => {
		expect(getMetadataFreshness(buffer, projection)).toMatchObject({ status: 'verified', allowsAutomaticInsertion: true });
		for (const changed of [
			{ sourceId: 'editor-B' }, { revision: 'edit-8' }, { path: 'Renamed.md' },
			{ text: buffer.text.replace('7', '8') }, { projectionRevision: 'dv-8' },
		]) {
			expect(getMetadataFreshness(buffer, { ...projection, evidence: { ...evidence, ...changed } }).status).toBe('unverified');
		}
	});
});
