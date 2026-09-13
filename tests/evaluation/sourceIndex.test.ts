import {findSuggestionContext, indexNote, NUMERALS_BLOCK_LANGUAGES, type BlockCalculationSource, type NoteSourceIndex} from '../../src/evaluation/sourceIndex';
import {contiguousSourceSpan, sourceSpansForRange} from '../../src/evaluation/sourceProjection';

function index(text: string): NoteSourceIndex { return indexNote({sourceId: 'editor-1', path: 'note.md', revision: 1, text}); }
function expressions(text: string): string[] {
	return index(text).calculations.map(calculation => calculation.kind === 'inline' ? calculation.expression.text : calculation.projection.text);
}
function block(text: string): BlockCalculationSource {
	const result = index(text).calculations[0];
	if (result?.kind !== 'block') throw new Error('Expected a block');
	return result;
}

describe('complete-source Markdown calculation index (accepted Linux extraction policies)', () => {
	test.each([
		['ordinary fence', '```math\na=1\n```', ['a=1']],
		['four ticks containing shorter fences', '````math\na=1\n```\nb=2\n````', ['a=1\n```\nb=2']],
		['longer closing fence', '```math\n1+2\n`````', ['1+2']],
		['tilde fence', '~~~math-tex\n1+2\n~~~', ['1+2']],
		['mismatched fence', '```math\n1+2\n~~~\n3+4\n```', ['1+2\n~~~\n3+4']],
		['empty fence', '```math\n```', ['']],
		['blank body', '```math\n\n```', ['']],
		['blank rows', '```math\n1\n\n2\n\n```', ['1\n\n2\n']],
		['indented opener', '  ```math\n  1\n    2\n  ```', ['1\n  2']],
		['tab-indented example', '\t```math\n\t1\n\t```', []],
		['opaque outer fence', '````markdown\n```math\n1+2\n```\n`#:3`\n````', []],
		['case-normalized language', '```MATH\n1+2\n```', ['1+2']],
		['quote fence', '> ```math\n> a=1\n> b=a+2\n> ```', ['a=1\nb=a+2']],
		['nested quotes', '> > ```math\n> > a=1\n> > b=a+2\n> > ```', ['a=1\nb=a+2']],
		['quote list', '> - ```math\n>   a=1\n>   b=2\n>   ```', ['a=1\nb=2']],
		['list fence', '- item\n\n  ```math\n  a=1\n  b=2\n  ```', ['a=1\nb=2']],
		['indented list marker', '  - ```math\n    1\n    ```', ['1']],
		['nested list', '- outer\n  - ```math\n    1\n    ```', ['1']],
		['tab list', '-\t```math\n\t1\n\t```', ['1']],
		['ambiguous tab quote', '>\t```math\n>\t1\n>\t```', []],
		['ambiguous opener quote tab', '>\t```math\n>   1\n>\t```', []],
		['body quote tab remains literal', '> ```math\n>\t1\n> ```', ['\t1']],
		['nested quote consumes virtual list indentation', '- > ```math\n\t> 1\n\t> ```', ['1']],
		['inline quote tab remains literal', '> `#:1+\n>\t2`', ['1+ \t2']],
		['CR line endings', '```math\r1\r```', ['1']],
		['ordered list', '123. ```math\n     1\n     2\n     ```', ['1\n2']],
		['collapsed callout', '> [!note]- Calculations\n> ```math\n> $x=1\n> ```\n> `#: $x+1`', ['$x=1', ' $x+1']],
		['inline code', 'one `#:1+2` two', ['1+2']],
		['two-tick inline', 'one ``#: 1 + `literal` `` two', [' 1 + `literal` ']],
		['three-tick inline', 'one ```#:1+2``` two', ['1+2']],
		['mismatched inline', 'one ``#:1+2` two', []],
		['escaped opener', 'one \\`#:1+2` two', []],
		['one paired space', '` #:1+2 `', ['1+2']],
		['two paired spaces', '`  #:1+2  `', []],
		['inline newline', '`#:1 +\n2`', ['1 + 2']],
		['quote inline newline', '> `#:1 +\n> 2`', ['1 + 2']],
		['lazy quote continuation', '> `#:1 +\n2`', ['1 + 2']],
		['list inline newline', '- `#:1 +\n  2`', ['1 + 2']],
		['inline CRLF', '`#:1 +\r\n2`', ['1 + 2']],
		['block CRLF', '```math\r\na=1\r\n\r\nb=2\r\n```\r\n', ['a=1\n\nb=2']],
		['frontmatter', '---\ntitle: "`#:99`"\nmath: |\n  ```math\n  100\n  ```\n---\n`#:1`', ['1']],
		['open frontmatter', '---\ntitle: "`#:99`"\n`#:1`', []],
		['BOM frontmatter', '\uFEFF---\ntitle: "`#:99`"\n---\n`#:1`', ['1']],
		['inline percent comment', 'before %% `#:99` %% after `#:1`', ['1']],
		['block percent comment', '%%\n```math\n99\n```\n%%\n`#:1`', ['1']],
		['percent inside code', '```math\n"%%"\n```\n`#: "%%"`', ['"%%"', ' "%%"']],
		['unclosed percent comment', 'before %% `#:99`\n```math\n100\n```', []],
		['HTML comment', '<!-- `#:99` -->\n`#:1`', ['1']],
		['HTML block', '<div>\n`#:99`\n</div>\n\n`#:1`', ['1']],
		['HTML inline element', 'text <span>`#:99`</span> `#:1`', ['99', '1']],
		['HTML nested element', 'text <span><span>`#:99`</span>`#:98`</span> `#:1`', ['99', '98', '1']],
		['HTML block continues past closing element', '<div><!-- </div> -->\n`#:99`\n</div>\n`#:1`', []],
		['HTML raw code element', 'text <code>#:99</code> `#:1`', ['1']],
		['embed', '![[Other#^block]]\n`#:1`', ['1']],
		['link label', '[`#:1`](target)', ['1']],
		['image alt', '![`#:1`](picture.png)', []],
		['wiki alias', '[[Other|`#:1`]]', []],
		['embed alias', '![[Other|`#:1`]]', []],
		['footnote', 'text[^n]\n\n[^n]: `#:1`', ['1']],
		['inline footnote', 'text ^[note `#:1`]', ['1']],
		['table', '| Calc |\n| --- |\n| `#:1` |', ['1']],
		['inline math', 'text $f(`#:99`)$ `#:1`', ['1']],
		['single-dollar math cannot cross LF paragraphs', '$x\n\n`#:1`\n\nz$', ['1']],
		['single-dollar math cannot cross CR paragraphs', '$x\r\r`#:1`\r\rz$', ['1']],
		['single-dollar math cannot cross empty quoted paragraphs', '> $x\n>\n> `#:1`\n>\n> z$', ['1']],
		['display math', '$$\n`#:99`\n$$\n`#:1`', ['1']],
		['literal entity', '`#: "&amp;"`', [' "&amp;"']],
		['empty expression', 'Value `#:`', []],
		['table escaped pipe remains literal', '| Calc |\n| --- |\n| `#: "a\\|b"` |', [' "a\\|b"']],
	] as const)('%s', (_name, text, expected) => {
		expect(expressions(text)).toEqual(expected);
		for (const calculation of index(text).calculations) {
			const projections = [calculation.projection, ...(calculation.kind === 'block' ? calculation.rows.map(row => row.projection) : [calculation.expression])];
			for (const projection of projections) for (const segment of projection.segments) {
				expect(segment.source.start).toBeGreaterThanOrEqual(0);
				expect(segment.source.end).toBeLessThanOrEqual(text.length);
				expect(segment.target.end).toBeLessThanOrEqual(projection.text.length);
				if (segment.kind === 'copy') expect(text.slice(segment.source.start, segment.source.end)).toBe(projection.text.slice(segment.target.start, segment.target.end));
			}
		}
	});

	test('records distinct occurrences and revision-scoped identities, separate from path', () => {
		const text = '`#:1` and `#:1`\n\n```math\n1\n```\n\n```math\n1\n```';
		const source = {sourceId: 'buffer-A', revision: 'rev1', path: 'file.md', text};
		const first = indexNote(source), renamed = indexNote({...source, path: 'renamed.md'}), revised = indexNote({...source, revision: 'rev2'});
		expect(first.calculations).toHaveLength(4);
		expect(new Set(first.calculations.map(item => item.id)).size).toBe(4);
		expect(first.calculations.map(item => item.id)).toEqual(renamed.calculations.map(item => item.id));
		expect(first.calculations.map(item => item.id)).not.toEqual(revised.calculations.map(item => item.id));
		expect(first.calculations.map(item => item.span.start)).toEqual([0, 10, 17, 32]);
		expect(first.compatibility).toBe('obsidian-1.13.7-linux-fixtures');
	});

	test.each(NUMERALS_BLOCK_LANGUAGES)('recognizes registered language %s and preserves its original spelling', language => {
		const result = block(`~~~${language}\n1\n~~~`);
		expect(result.language).toBe(language.toLowerCase());
		expect(result.rawInfo).toBe(language);
	});

	test.each(['MATH extra', 'Math-TeX {#id .calc}', 'math\textra', 'math-PLAIN a=b', 'MATH-HIGHLIGHT'])('uses only the exact lowercased first info token: %s', rawInfo => {
		const result = block('```' + rawInfo + '\n1\n```');
		expect(result.language).toBe(rawInfo.split(/[ \t]/, 1)[0].toLowerCase());
		expect(result.rawInfo).toBe(rawInfo);
	});

	test.each(['mathematics', 'maths', 'math-texx', 'math{#id}', 'text math', 'math_extra'])('does not use loose fence language prefixes: %s', info => {
		expect(expressions('```' + info + '\n`#: $leaked=1`\n```\n\n`#:2`')).toEqual(['2']);
	});

	test.each([...NUMERALS_BLOCK_LANGUAGES, 'text', 'markdown', '', 'MATH extra'])('withholds every unclosed quote fence regardless of language: %s', language => {
		for (const prefix of ['> ', '> > ', '- > ']) {
			const text = '`#: $before=1`\n\n' + prefix + '```' + language + '\n' + prefix + '1+2\noutside `#: $leaked=99`';
			const result = index(text);
			expect(result.evaluationBlocked).toBe(true);
			expect(result.calculations).toEqual([]);
			expect(result.suggestionRegions).toEqual([]);
			expect(findSuggestionContext(result, text.indexOf('$leaked') + '$leaked'.length)).toBeNull();
			expect(result.diagnostics.map(item => item.code)).toContain('ambiguous-container');
		}
	});

	test.each(['math', 'MATH extra', 'text', ''])('withholds closed quoted-tab fences without exposing any globals: %s', language => {
		for (const prefix of ['>\t', '> \t', '> >\t', '> -\t', '-\t> ']) {
			for (const marker of ['```', '~~~~']) {
				const text = '`#: $before=1`\n\n' + prefix + marker + language + '\n>\t`#: $leaked=99`\n>\t' + marker + '\n\n`#: $after=2`';
				const result = index(text);
				expect(result.evaluationBlocked).toBe(true);
				expect(result.calculations).toEqual([]);
				expect(result.proseRegions).toEqual([]);
				expect(result.diagnostics.map(item => item.code)).toContain('ambiguous-container');
			}
		}
	});

	test.each([...NUMERALS_BLOCK_LANGUAGES, 'text', 'markdown', '', 'math extra'])('withholds the note for ambiguous tab-container fence language %s', language => {
		const text = '>\t- ```' + language + '\n>\t  `#: $leaked=99`\n>\t  ```\n\n`#:2`';
		const result = index(text);
		expect(result.evaluationBlocked).toBe(true);
		expect(result.calculations).toEqual([]);
		expect(result.suggestionRegions).toEqual([]);
		expect(result.proseRegions).toEqual([]);
		expect(findSuggestionContext(result, text.indexOf('$leaked') + '$leaked'.length)).toBeNull();
		expect(result.diagnostics.some(diagnostic => diagnostic.code === 'ambiguous-container' && diagnostic.message.includes('Note evaluation is withheld'))).toBe(true);
	});

	test('ambiguous container withholding includes calculations preceding the apparent fence', () => {
		const text = '`#: $before=1`\n\n>\t- ~~~text\n>\t  `#: $leaked=99`\n>\t  ~~~\n\n`#:2`';
		const result = index(text);
		expect(result.evaluationBlocked).toBe(true);
		expect(result.calculations).toEqual([]);
		expect(result.diagnostics.some(diagnostic => diagnostic.code === 'ambiguous-container')).toBe(true);
	});

	test('ordinary closed list tabs and unclosed nonquote fences remain indexable', () => {
		for (const text of ['-\t```math\n\t1\n\t```', '```math\n1', '- ```math\n  1']) {
			const result = index(text);
			expect(result.evaluationBlocked).toBe(false);
			expect(result.calculations).toHaveLength(1);
		}
		const result = index('- ```math\n  1\noutside `#:3`');
		expect(result.calculations.map(item => item.projection.text)).toEqual(['1', '#:3']);
		expect(result.calculations[0].closed).toBe(false);
		expect(result.diagnostics.map(item => item.code)).toContain('unclosed-region');
	});

	test('physical rows distinguish no body from a blank body', () => {
		expect(block('```math\n```').rows).toHaveLength(0);
		expect(block('```math\n\n```').rows).toHaveLength(1);
		const rows = block('```math\n1\n\n2\n\n```').rows;
		expect(rows.map(row => row.line)).toEqual([1, 2, 3, 4]);
		expect(rows.map(row => row.projection.text)).toEqual(['1', '', '2', '']);
	});

	test('UTF-16 offsets, original CRLF spans, and delimiter lengths survive', () => {
		const text = '😀\r\n````math\r\n$x=2\r\n`````\r\n``#: $x+1``';
		const result = index(text);
		expect(result.lineStarts).toEqual([0, 4, 14, 20, 27]);
		const fence = result.calculations[0];
		expect(text.slice(fence.opener.start, fence.opener.end)).toBe('````');
		expect(text.slice(fence.closer!.start, fence.closer!.end)).toBe('`````');
		expect(fence.span.start).toBe(4);
		expect(result.source.text).toBe(text);
	});

	test('footnote continuations and fences retain source order instead of rendered relocation', () => {
		const text = '[^n]: `#:1`\n\n    ```math\n    $x=2\n    ```\n    more `#:3`\n\nbody `#:4`';
		expect(expressions(text)).toEqual(['1', '$x=2', '3', '4']);
		expect(index(text).calculations[1].containers.map(container => container.kind)).toEqual(['footnote']);
	});

	test('code and exclusions have lexical precedence', () => {
		expect(expressions('`#: "%% <!-- [[ $"`\n`#:1`')).toEqual([' "%% <!-- [[ $"', '1']);
		expect(expressions('%%\n```math\n99\n```\n%%\n```math\n1\n```')).toEqual(['1']);
		expect(expressions('`#: "<span>"`\n`#:1`')).toEqual([' "<span>"', '1']);
		expect(expressions('![%%](x) `#:1`')).toEqual(['1']);
		expect(expressions('[label](<%%>) `#:1`')).toEqual(['1']);
	});

	test('inline HTML attributes stay opaque while Markdown children retain physical spans', () => {
		const text = 'text <span title="`#: $attribute=99`"><b>`#: $inside=2`</b></span> `#: $inside+1`';
		const result = index(text);
		expect(expressions(text)).toEqual([' $inside=2', ' $inside+1']);
		expect(result.calculations.map(item => text.slice(item.span.start, item.span.end))).toEqual(['`#: $inside=2`', '`#: $inside+1`']);
		expect(findSuggestionContext(result, text.indexOf('$attribute') + '$attribute'.length)).toBeNull();
	});

	test.each(['code', 'pre', 'script', 'style', 'textarea'])('raw HTML %s content cannot introduce source calculations', tag => {
		const text = 'text <' + tag + '>#:99 `#: $hidden=2`</' + tag + '> `#:1`';
		expect(expressions(text)).toEqual(['1']);
		expect(findSuggestionContext(index(text), text.indexOf('$hidden') + '$hidden'.length)).toBeNull();
	});

	test('raw HTML closure ignores nested comments and preserves conservative unfinished exclusion', () => {
		expect(expressions('text <code><!-- </code> -->`#: $hidden=2`</code> `#:1`')).toEqual(['1']);
		const result = index('text <code>`#: $hidden=2`\n\n`#: $later=3`');
		expect(result.calculations).toEqual([]);
		expect(result.diagnostics.map(item => item.code)).toContain('unclosed-region');
	});

	test.each(['code', 'pre', 'script', 'style', 'textarea'])('unclosed raw HTML block %s excludes through EOF with a diagnostic', tag => {
		const text = '<' + tag + '>\n`#: $hidden=2`\n\n`#: $later=3`';
		const result = index(text);
		expect(result.calculations).toEqual([]);
		expect(result.excludedRegions).toContainEqual({kind: 'html', span: {start: 0, end: text.length}, closed: false});
		expect(result.diagnostics.map(item => item.code)).toContain('unclosed-region');
	});

	test('an ordinary HTML block uses its Markdown extent without requiring paired tags', () => {
		const text = '<div>\n`#: $hidden=2`\n\n`#: $later=3`';
		expect(expressions(text)).toEqual([' $later=3']);
		expect(index(text).diagnostics).toEqual([]);
	});

	test.each(['code', 'pre', 'script', 'style', 'textarea'])('nested raw %s outlives an ordinary HTML block blank-line boundary', tag => {
		const text = `<div><${tag}>\n\`#: $hidden=2\`\n\n\`\`\`math\n$leaked=3\n\`\`\`\n</${tag}></div>\n\n\`#:4\``;
		expect(expressions(text)).toEqual(['4']);
		const region = index(text).excludedRegions.find(item => item.kind === 'html');
		expect(region?.span.end).toBeGreaterThanOrEqual(text.indexOf(`</${tag}>`) + tag.length + 3);
		expect(region?.closed).toBe(true);
	});

	test.each(['code', 'pre', 'script', 'style', 'textarea'])('unclosed nested raw %s excludes later globals through EOF', tag => {
		const text = `<div>\n<${tag}>\n\n\`#: $leaked=3\``;
		const result = index(text);
		expect(result.calculations).toEqual([]);
		expect(result.diagnostics.some(item => item.code === 'unclosed-region')).toBe(true);
		expect(findSuggestionContext(result, text.length - 1)).toBeNull();
	});

	test('nested raw detection skips attributes, comments and CDATA while retaining subsequent siblings', () => {
		for (const prefix of ['<div data-example="<code>">', '<div><!-- <pre> -->', '<div><![CDATA[<textarea>]]>']) {
			expect(expressions(`${prefix}\n\n\`#:4\``)).toEqual(['4']);
		}
		expect(expressions('<div><code>safe</code><pre>\n\n`#: $leaked=3`\n</pre></div>\n\n`#:4`')).toEqual(['4']);
	});

	test.each(['<div><code>', 'text <code>', '<code>', '<div>\n<code>'])('raw region from %s preserves the whole closing-tag HTML block', opener => {
		const text = `${opener}\n\n</code>\n\`#:$phantom=3\`\n\n\`#:4\``;
		expect(expressions(text)).toEqual(['4']);
		expect(index(text).excludedRegions.find(item => item.kind === 'html')?.span.end)
			.toBeGreaterThanOrEqual(text.indexOf('\n\n`#:4`'));
	});

	test('raw exclusions grow transitively through HTML blocks and later raw openers', () => {
		const text = '<div><code>\n\n</code><pre>\n\n</pre>\n`#:$phantom=3`\n\n`#:4`';
		expect(expressions(text)).toEqual(['4']);
		expect(expressions('text <pre>\n\n</pre>\n```math\n$phantom=3\n```\n\n`#:4`')).toEqual(['4']);
	});

	test.each(['code', 'pre', 'script', 'style', 'textarea'])('a slash does not close the nonvoid raw %s element', tag => {
		for (const prefix of [`text <${tag}/>`, `<div><${tag}/>`]) {
			const text = `${prefix}\n\n\`#:$leak=1\``;
			const result = index(text);
			expect(result.calculations).toEqual([]);
			expect(result.diagnostics.some(item => item.code === 'unclosed-region')).toBe(true);
			expect(expressions(`${text}\n</${tag}>\n\n\`#:4\``)).toEqual(['4']);
		}
		expect(expressions(`text <${tag}><${tag}/>\`#:$leak=1\`</${tag}>\n\n\`#:4\``)).toEqual([]);
	});

	test('structural HTML block extent excludes phantom globals beyond a closing tag', () => {
		const text = '<div><!-- </div> -->\n`#: $inside=2`\n</div>\n`#: $phantom=3`\n\n`#: $real=4`';
		const result = index(text);
		expect(expressions(text)).toEqual([' $real=4']);
		const html = result.excludedRegions.find(region => region.kind === 'html');
		expect(html?.span).toEqual({start: 0, end: text.indexOf('\n\n')});
		expect(findSuggestionContext(result, text.indexOf('$phantom') + '$phantom'.length)).toBeNull();
	});

	test('longest nonempty trigger wins, exact duplicates disable their mode', () => {
		const source = {sourceId: 'note', revision: 1, text: '`##: 2` `#:3` `ignored`'};
		const result = indexNote(source, {triggers: [
			{trigger: '#', mode: 'result', renderStyle: 'plain'},
			{trigger: '##:', mode: 'equation', renderStyle: 'tex'},
			{trigger: '', mode: 'equation', renderStyle: 'plain'},
		]});
		expect(result.calculations.map(item => item.kind === 'inline' ? [item.trigger, item.expression.text] : null)).toEqual([['##:', ' 2'], ['#', ':3']]);
		const duplicate = indexNote(source, {triggers: [
			{trigger: '#', mode: 'result', renderStyle: 'plain'},
			{trigger: '#', mode: 'equation', renderStyle: 'tex'},
		]});
		expect(duplicate.calculations).toEqual([]);
		expect(duplicate.diagnostics.map(item => item.code)).toEqual(['duplicate-trigger']);
		expect(indexNote(source, {inlineEnabled: false}).calculations).toEqual([]);
	});
});

describe('source projection safety', () => {
	test('maps quote/list text without turning removed prefixes into a replacement span', () => {
		const text = '> - ```math\n>   a=1\n>   b=2\n>   ```';
		const result = block(text);
		expect(sourceSpansForRange(result.projection, 0, result.projection.text.length).map(span => text.slice(span.start, span.end))).toEqual(['a=1\n', 'b=2']);
		expect(contiguousSourceSpan(result.projection, 0, result.projection.text.length)).toBeNull();
		const row = result.rows[1];
		const safe = contiguousSourceSpan(row.projection, 0, row.projection.text.length);
		expect(safe && text.slice(safe.start, safe.end)).toBe('b=2');
		expect(text.slice(row.span.start, row.span.end)).toBe('>   b=2');
	});

	test('inline trigger removal and newline normalization preserve source spans', () => {
		const text = '> `` #:a +\r\n> b ``';
		const result = index(text).calculations[0];
		if (result.kind !== 'inline') throw new Error('Expected inline');
		expect(result.expression.text).toBe('a + b');
		expect(sourceSpansForRange(result.expression, 0, result.expression.text.length).map(span => text.slice(span.start, span.end))).toEqual(['a +\r\n', 'b']);
		expect(contiguousSourceSpan(result.expression, 0, result.expression.text.length)).toBeNull();
		expect(contiguousSourceSpan(result.expression, 0, 1)).toEqual({start: text.indexOf('a +'), end: text.indexOf('a +') + 1});
	});

	test('partial tab indentation has an explicit expansion mapping', () => {
		const text = '  ```math\n\t1\n  ```';
		const result = block(text);
		expect(result.projection.text).toBe('  1');
		expect(result.projection.segments.some(segment => segment.kind === 'expand-tab')).toBe(true);
		expect(contiguousSourceSpan(result.projection, 0, 3)).toBeNull();
	});

	test('a quote body content tab is copied without inventing virtual source spaces', () => {
		const text = '> ```math\r\n>\t"a\tb"\r\n> ```';
		const result = block(text);
		expect(result.projection.text).toBe('\t"a\tb"');
		expect(result.rows[0].projection.segments.some(segment => segment.kind === 'expand-tab')).toBe(false);
		const span = contiguousSourceSpan(result.projection, 0, result.projection.text.length);
		expect(span).toEqual({start: text.indexOf('\t"'), end: text.indexOf('\r\n> ```')});
		expect(span && text.slice(span.start, span.end)).toBe('\t"a\tb"');
	});

	test('inline quote content tab maps independently from normalized newline and removed prefix', () => {
		const text = '> `#: "a\r\n>\tb"`';
		const result = index(text).calculations[0];
		if (result.kind !== 'inline') throw new Error('Expected inline');
		expect(result.expression.text).toBe(' "a \tb"');
		const tab = result.expression.text.indexOf('\t');
		expect(contiguousSourceSpan(result.expression, tab, tab + 1)).toEqual({start: text.indexOf('\tb'), end: text.indexOf('\tb') + 1});
		expect(sourceSpansForRange(result.expression, 0, result.expression.text.length).map(span => text.slice(span.start, span.end))).toEqual([' "a\r\n', '\tb"']);
		expect(contiguousSourceSpan(result.expression, 0, result.expression.text.length)).toBeNull();
	});
});

describe('suggestion contexts are distinct from evaluated occurrences', () => {
	test.each(['Value `#: cost', 'Value ``#: cost', '> Value `#: cost', '- Value `#: cost'])('unfinished span: %s', text => {
		const result = index(text);
		expect(result.calculations).toEqual([]);
		const suggestion = findSuggestionContext(result, text.length);
		expect(suggestion?.kind).toBe('unfinished');
		expect(suggestion?.expression.text).toBe(' cost');
	});

	test('completed empty code offers suggestions but does not evaluate', () => {
		const result = index('Value `#:`');
		expect(result.calculations).toEqual([]);
		expect(findSuggestionContext(result, 9)?.kind).toBe('complete');
	});

	test.each(['Value \\`#: cost', '%% `#: cost', '```text\n`#: cost\n```', '---\nx: `#: cost', '![`#: cost](x)'])('excluded source: %s', text => {
		expect(findSuggestionContext(index(text), text.length)).toBeNull();
	});

	test('matched ordinary code cannot become an unfinished Numerals expression', () => {
		const text = '`ordinary` then `#: cost';
		expect(findSuggestionContext(index(text), text.length)?.expression.text).toBe(' cost');
	});
});
