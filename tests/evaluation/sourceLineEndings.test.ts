import {readFileSync} from 'node:fs';
import path from 'node:path';
import {indexNote, type NoteSourceIndex} from '../../src/evaluation/sourceIndex';
import {contiguousSourceSpan, type SourceProjection} from '../../src/evaluation/sourceProjection';

const fixtures = (JSON.parse(readFileSync(path.resolve('host-tests/fixtures/sources.json'), 'utf8')) as {
	cases: {id: string; text: string}[];
}).cases;
const lf = (text: string): string => text.replace(/\r\n?/g, '\n');
const index = (text: string): NoteSourceIndex => indexNote({sourceId: 'line-ending-buffer', revision: text, text});

function semantics(result: NoteSourceIndex): unknown {
	return {
		blocked: result.evaluationBlocked,
		diagnostics: result.diagnostics.map(item => item.code),
		calculations: result.calculations.map(item => ({kind: item.kind, closed: item.closed,
			text: item.projection.text, original: lf(result.source.text.slice(item.span.start, item.span.end)),
			...(item.kind === 'block' ? {language: item.language, rows: item.rows.map(row => row.projection.text)} : {}),
			containers: item.containers.map(container => ({kind: container.kind,
				original: lf(result.source.text.slice(container.span.start, container.span.end))})),
		})),
	};
}

function verifyOriginalMappings(text: string, projection: SourceProjection): void {
	for (const segment of projection.segments) {
		expect(segment.source.start).toBeGreaterThanOrEqual(0);
		expect(segment.source.end).toBeLessThanOrEqual(text.length);
		if (segment.kind === 'copy') expect(text.slice(segment.source.start, segment.source.end))
			.toBe(projection.text.slice(segment.target.start, segment.target.end));
	}
	// Every candidate accepted as a contiguous insertion span must still name
	// exactly those bytes in this original buffer, including astral code units.
	for (let at = 0; at < projection.text.length; at++) {
		for (const end of [at + 1, projection.text.length]) {
			const span = contiguousSourceSpan(projection, at, end);
			if (span) expect(text.slice(span.start, span.end)).toBe(projection.text.slice(at, end));
		}
	}
}

describe('generated source line-ending equivalence, separate from native capture evidence', () => {
	test.each(fixtures)('fixture $id retains semantics and original mappings under LF, CRLF and CR', fixture => {
		const baseline = lf(fixture.text);
		const expected = semantics(index(baseline));
		for (const ending of ['\n', '\r\n', '\r']) {
			const text = baseline.replace(/\n/g, ending);
			const result = index(text);
			expect(semantics(result)).toEqual(expected);
			for (const calculation of result.calculations) {
				verifyOriginalMappings(text, calculation.projection);
				if (calculation.kind === 'inline') verifyOriginalMappings(text, calculation.expression);
				else for (const row of calculation.rows) verifyOriginalMappings(text, row.projection);
			}
		}
	});

	test.each(['\n', '\r\n', '\r'])('preserves HTML blank boundaries and unclosed list row counts with %j', ending => {
		const html = '<div>\ntext\n</div>\n\n`#:4`'.replace(/\n/g, ending);
		expect(index(html).calculations.map(item => item.projection.text)).toEqual(['#:4']);
		const nested = '<div><code>\n\n</code>\n`#:$phantom=3`\n\n`#:4`'.replace(/\n/g, ending);
		expect(index(nested).calculations.map(item => item.projection.text)).toEqual(['#:4']);
		const list = '- ```math\n  109\n\noutside `#:4`'.replace(/\n/g, ending);
		const calculations = index(list).calculations;
		expect(calculations.map(item => item.projection.text)).toEqual(['109', '#:4']);
		expect(calculations[0].kind === 'block' && calculations[0].rows).toHaveLength(1);
	});

	test.each(['\n', '\r\n', '\r'])('retains astral prefixes, quoted lists and physical footnotes with %j', ending => {
		const text = '😀 before\n\n<div>\nignored\n</div>\n\n> - ```Math attrs\n>   $x=2\n>   ```\n\n[^n]: `#:$x+1`'.replace(/\n/g, ending);
		const calculations = index(text).calculations;
		expect(calculations.map(item => item.projection.text)).toEqual(['$x=2', '#:$x+1']);
		expect(calculations[0].opener.start).toBe(text.indexOf('```'));
		expect(calculations[1].opener.start).toBe(text.indexOf('`#:'));
		for (const calculation of calculations) verifyOriginalMappings(text, calculation.projection);
	});
});
