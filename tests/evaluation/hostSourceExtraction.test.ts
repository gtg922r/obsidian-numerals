import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {indexNote} from '../../src/evaluation/sourceIndex';

interface SourceFixture {id: string; path: string; sha256: string; text: string;}
interface Observation {
	sequence: number; kind: 'block-handler' | 'inline-code'; origin: 'reading'; sourcePath: string;
	language?: string; source?: string; text?: string;
}
interface CapturedCase {id: string; path: string; sourceSha256: string; events: Observation[];}
interface ReadingEvidence {sourcesSha256: string; captureSha256: string; cases: CapturedCase[];}
interface Occurrence {kind: 'block' | 'inline'; text: string; language?: string;}
const sourceBytes = readFileSync(path.resolve('host-tests/fixtures/sources.json'));
const sources = (JSON.parse(sourceBytes.toString()) as {cases: SourceFixture[]}).cases;
const evidence = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/obsidian-1.13.7-linux-reading.json'), 'utf8')) as ReadingEvidence;
const triggers = ['#$=:', '#$:', '#=:', '#:'];
const ambiguous = new Set(['020', '021', '078']);
const conservativeIncomplete = new Set(['031', '042', '047']);
const bag = (occurrences: readonly Occurrence[]): string[] => occurrences.map(item => JSON.stringify(item)).sort();

function capturedCalculations(events: Observation[]): Occurrence[] {
	return events.flatMap<Occurrence>(event => {
		if (event.kind === 'block-handler') return [{kind: 'block' as const, text: event.source!, language: event.language!}];
		const text = event.text!;
		return triggers.some(trigger => text.startsWith(trigger) && text.slice(trigger.length).trim())
			? [{kind: 'inline' as const, text}] : [];
	});
}

// Explicit owner-approved source policies. Never infer these expectations from
// indexNote: the capture is literal native evidence, not a parser-generated oracle.
function expectedSourceCalculations(id: string, native: Occurrence[]): Occurrence[] {
	if (ambiguous.has(id) || conservativeIncomplete.has(id)) return [];
	if (id === '053') return [{kind: 'inline', text: '#:1'}]; // Raw HTML <code> has no Markdown occurrence.
	if (id === '082') return [ // Unused definitions still participate at physical source positions.
		{kind: 'inline', text: '#:1'}, {kind: 'block', text: '$x=2', language: 'math'},
		{kind: 'inline', text: '#:3'}, {kind: 'inline', text: '#:4'},
	];
	return native;
}

describe('accepted official Obsidian 1.13.7 Linux Reading extraction', () => {
	test('binds all 95 observations to the unchanged authoritative source catalog', () => {
		expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(evidence.sourcesSha256);
		expect(evidence.captureSha256).toBe('97eda0fd8691c2e575a4510b6052bfafab82c429d27aea413f5ca9f9431989e4');
		expect(evidence.cases).toHaveLength(95);
		expect(evidence.cases.map(item => item.id)).toEqual(sources.map(item => item.id));
	});

	test.each(evidence.cases)('$id $path', captured => {
		const fixture = sources.find(item => item.id === captured.id)!;
		expect(captured.path).toBe(fixture.path);
		expect(captured.sourceSha256).toBe(fixture.sha256);
		expect(createHash('sha256').update(fixture.text).digest('hex')).toBe(fixture.sha256);
		for (const event of captured.events) {
			expect(event.origin).toBe('reading');
			expect(event.sourcePath).toBe(fixture.path);
		}
		const index = indexNote({sourceId: fixture.path, path: fixture.path, revision: fixture.sha256, text: fixture.text});
		const actual: Occurrence[] = index.calculations.map(calculation => ({kind: calculation.kind,
			text: calculation.projection.text, ...(calculation.kind === 'block' ? {language: calculation.language} : {})}));
		const expected = expectedSourceCalculations(fixture.id, capturedCalculations(captured.events));
		// Native callout dispatch visits inline before blocks. Preserve every
		// occurrence, including duplicates, while comparing payload multiplicity.
		expect(bag(actual)).toEqual(bag(expected));
		if (!['027', '080'].includes(fixture.id)) expect(actual).toEqual(expected);
		expect(index.calculations.map(item => item.span.start)).toEqual(index.calculations.map(item => item.span.start).sort((a, b) => a - b));
		expect(new Set(index.calculations.map(item => item.id)).size).toBe(index.calculations.length);
		expect(index.evaluationBlocked).toBe(ambiguous.has(fixture.id));
		if (ambiguous.has(fixture.id)) expect(index.diagnostics.some(item => item.code === 'ambiguous-container')).toBe(true);
		if (['042', '047'].includes(fixture.id)) expect(index.diagnostics.some(item => item.code === 'unclosed-region')).toBe(true);
		for (const calculation of index.calculations) for (const segment of calculation.projection.segments) {
			expect(segment.source.start).toBeGreaterThanOrEqual(0);
			expect(segment.source.end).toBeLessThanOrEqual(fixture.text.length);
			if (segment.kind === 'copy') expect(fixture.text.slice(segment.source.start, segment.source.end))
				.toBe(calculation.projection.text.slice(segment.target.start, segment.target.end));
		}
	});
});
