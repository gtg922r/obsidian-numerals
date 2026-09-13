import { all, create } from 'mathjs';
import { captureNoteEvaluationInput, evaluateNote } from '../../src/evaluation/evaluateNote';

function evaluate(text: string) {
	const engine = create(all);
	return evaluateNote(captureNoteEvaluationInput({
		generation: {sourceId: 'buffer:insertions', sourcePath: 'Note.md', sourceRevision: 1, sourceText: text,
			metadataRevision: '1', dependencyRevision: '1', evaluationSettingsRevision: '1', runtimeGeneration: 1},
		runtime: {engine, formatter: {format: value => ({text: engine.format(value), tex: engine.format(value), canonical: engine.format(value)})}},
		preProcessors: [], parseYaml: () => undefined,
	}));
}

describe('insertion spans in complete note snapshots', () => {
	it('retains complete stored values and exact physical spans through quote extraction, CRLF, and UTF-16 offsets', () => {
		const storedValues = ['[1, 2]', '[[1, 2], [3, 4]]', '"a]b"', '"a\\\"b]"', '[1, 2]'];
		const wrappers = storedValues.map(value => `@[x::${value}]`);
		const text = ['😀', '> ```math', ...wrappers.map((wrapper, index) => `> ${wrapper} = ${storedValues[index]}`), '> ```'].join('\r\n');
		const snapshot = evaluate(text);
		const calculation = snapshot.calculations[0];
		expect(calculation.diagnostic).toBeUndefined();
		expect(calculation.rows).toHaveLength(storedValues.length);
		const directives = calculation.block!.insertionDirectives;
		expect(directives).toHaveLength(wrappers.length);
		let precedingEnd = 0;
		for (const [index, directive] of directives.entries()) {
			const start = text.indexOf(wrappers[index], precedingEnd);
			expect(directive.rowIndex).toBe(index);
			expect(directive.expectedText).toBe(wrappers[index]);
			expect(directive.sourceSpans).toEqual([{start, end: start + wrappers[index].length}]);
			expect(calculation.sourceMap!.originalSource.slice(directive.expressionSpan.start, directive.expressionSpan.end)).toBe(wrappers[index]);
			const value = directive.storedValue!;
			expect(value.expectedText).toBe(storedValues[index]);
			expect(value.sourceSpans).toEqual([{start: start + 5, end: start + wrappers[index].length - 1}]);
			expect(calculation.sourceMap!.originalSource.slice(value.expressionSpan.start, value.expressionSpan.end)).toBe(storedValues[index]);
			expect(calculation.rows[index].processedInput.trim()).toBe(`x = ${storedValues[index]}`);
			precedingEnd = start + wrappers[index].length;
		}
	});

	it('distinguishes an absent stored value from an empty one without inventing a writable physical span', () => {
		const text = '```math\n@[x] = 2\n@[y::] = 3\n```';
		const snapshot = evaluate(text);
		const directives = snapshot.calculations[0].block!.insertionDirectives;
		expect(directives[0].storedValue).toBeUndefined();
		expect(directives[1].storedValue).toEqual({expressionSpan: {start: 14, end: 14}, sourceSpans: [], expectedText: ''});
		expect(directives[1].sourceSpans.map(span => text.slice(span.start, span.end))).toEqual(['@[y::]']);
	});
});
