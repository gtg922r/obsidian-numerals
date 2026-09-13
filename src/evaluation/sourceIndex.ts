import {GFM, parser, type MarkdownConfig} from '@lezer/markdown';
import {Tree, type SyntaxNode} from '@lezer/common';
import {
	createProjection, joinProjections, sliceProjection,
	type ProjectionPart, type SourceProjection, type SourceSpan,
} from './sourceProjection';

/** Exactly the names registered by Numerals' block processors. */
export const NUMERALS_BLOCK_LANGUAGES = ['math', 'Math', 'math-plain', 'math-tex', 'math-TeX', 'math-highlight'] as const;
export type NumeralsBlockLanguage = typeof NUMERALS_BLOCK_LANGUAGES[number];

export interface NoteSource {
	readonly sourceId: string;
	readonly revision: string | number;
	/** A path is not an editor/buffer identity. */
	readonly path?: string;
	readonly text: string;
}

export interface InlineTrigger {
	readonly trigger: string;
	readonly mode: 'result' | 'equation';
	readonly renderStyle: 'plain' | 'tex';
}

export interface SourceSyntaxPolicy {
	readonly inlineEnabled?: boolean;
	readonly triggers?: readonly InlineTrigger[];
}

const DEFAULT_TRIGGERS: readonly InlineTrigger[] = [
	{trigger: '#:', mode: 'result', renderStyle: 'plain'},
	{trigger: '#=:', mode: 'equation', renderStyle: 'plain'},
	{trigger: '#$:', mode: 'result', renderStyle: 'tex'},
	{trigger: '#$=:', mode: 'equation', renderStyle: 'tex'},
];

export interface SourceContainer {
	readonly kind: 'blockquote' | 'list-item' | 'footnote';
	readonly span: SourceSpan;
	readonly marker: SourceSpan | null;
	readonly indentColumns: number;
}

export interface PhysicalBlockRow {
	/** Zero-based physical source line, including empty body rows. */
	readonly line: number;
	/** Whole physical line, including container prefixes but excluding its line ending. */
	readonly span: SourceSpan;
	readonly lineEnding: SourceSpan;
	readonly projection: SourceProjection;
}

interface CalculationSourceBase {
	readonly id: string;
	readonly span: SourceSpan;
	readonly opener: SourceSpan;
	readonly closer: SourceSpan | null;
	readonly closed: boolean;
	readonly containers: readonly SourceContainer[];
	readonly projection: SourceProjection;
}

export interface BlockCalculationSource extends CalculationSourceBase {
	readonly kind: 'block';
	readonly language: NumeralsBlockLanguage;
	readonly rawInfo: string;
	readonly rows: readonly PhysicalBlockRow[];
}

export interface InlineCalculationSource extends CalculationSourceBase {
	readonly kind: 'inline';
	readonly trigger: string;
	readonly mode: InlineTrigger['mode'];
	readonly renderStyle: InlineTrigger['renderStyle'];
	/** Code-span projection with only the trigger removed. Whitespace remains input. */
	readonly expression: SourceProjection;
}

export type CalculationSource = BlockCalculationSource | InlineCalculationSource;
export type ExclusionKind = 'frontmatter' | 'obsidian-comment' | 'html-comment' | 'html' | 'math' | 'wikilink' | 'embed' | 'image' | 'link-target' | 'code';
export interface ExcludedSourceRegion {
	readonly kind: ExclusionKind;
	readonly span: SourceSpan;
	readonly closed: boolean;
}

export interface SourceIndexDiagnostic {
	readonly code: 'unclosed-region' | 'duplicate-trigger' | 'exclusion-limit' | 'ambiguous-container';
	readonly message: string;
	readonly span: SourceSpan;
}

export interface SuggestionRegion {
	readonly span: SourceSpan;
	readonly opener: SourceSpan;
	readonly closer: SourceSpan | null;
	readonly projection: SourceProjection;
}

export interface NoteSourceIndex {
	readonly source: NoteSource;
	readonly calculations: readonly CalculationSource[];
	readonly excludedRegions: readonly ExcludedSourceRegion[];
	readonly diagnostics: readonly SourceIndexDiagnostic[];
	readonly lineStarts: readonly number[];
	readonly compatibility: 'obsidian-1.13.7-linux-fixtures';
	/** No math, including metadata expressions, may run for an ambiguous parse. */
	readonly evaluationBlocked: boolean;
	/** Real complete code spans plus eligible prose; these do not imply evaluation. */
	readonly suggestionRegions: readonly SuggestionRegion[];
	readonly proseRegions: readonly SourceSpan[];
	readonly triggers: readonly InlineTrigger[];
}

export interface InlineSuggestionContext {
	readonly kind: 'complete' | 'unfinished';
	readonly span: SourceSpan;
	readonly opener: SourceSpan;
	readonly closer: SourceSpan | null;
	readonly trigger: string;
	readonly expression: SourceProjection;
}

/** Public Lezer composite API: footnotes retain their physical definition order. */
const footnotes: MarkdownConfig = {
	defineNodes: [{name: 'NumeralsFootnote', block: true, composite(_cx, line) {
		if (line.pos !== line.text.length && line.indent < line.baseIndent + 4) return false;
		line.moveBaseColumn(line.baseIndent + 4);
		return true;
	}}, 'NumeralsFootnoteMark'],
	parseBlock: [{name: 'NumeralsFootnote', before: 'LinkReference', parse(cx, line) {
		if (line.indent - line.baseIndent >= 4) return false;
		const match = /^\[\^[^\]\r\n]+\]:[ \t]*/.exec(line.text.slice(line.pos));
		if (!match) return false;
		const start = line.pos;
		cx.startComposite('NumeralsFootnote', start);
		cx.addElement(cx.elt('NumeralsFootnoteMark', cx.lineStart + start, cx.lineStart + start + match[0].length));
		line.moveBase(start + match[0].length);
		return null;
	}}],
};
const markdown = parser.configure([GFM, footnotes]);

interface ParsedNodes {
	readonly root: SyntaxNode;
	readonly code: SyntaxNode[];
	readonly opaque: {node: SyntaxNode; kind: ExclusionKind}[];
	readonly prose: SyntaxNode[];
}

/** Normalize parser input once, then restore every node to original UTF-16 coordinates. */
function parseSourceTree(text: string): SyntaxNode {
	if (!text.includes('\r')) return markdown.parse(text).topNode;
	let normalized = '';
	const originalOffsets = [0];
	for (let at = 0; at < text.length; at++) {
		if (text[at] === '\r') {
			normalized += '\n';
			if (text[at + 1] === '\n') at++;
		} else normalized += text[at];
		originalOffsets.push(at + 1);
	}
	const parsed = markdown.parse(normalized).topNode;
	const buffer: number[] = [];
	const append = (node: SyntaxNode): void => {
		const start = buffer.length;
		for (let child = node.firstChild; child; child = child.nextSibling) append(child);
		buffer.push(node.type.id, originalOffsets[node.from], originalOffsets[node.to], buffer.length - start + 4);
	};
	for (let child = parsed.firstChild; child; child = child.nextSibling) append(child);
	return Tree.build({buffer, nodeSet: markdown.nodeSet, topID: parsed.type.id, length: text.length}).topNode;
}

function parseNodes(text: string): ParsedNodes {
	const root = parseSourceTree(text);
	const code: SyntaxNode[] = [], opaque: ParsedNodes['opaque'] = [], prose: SyntaxNode[] = [];
	function visit(node: SyntaxNode): void {
		if (node.name === 'FencedCode' || node.name === 'InlineCode' || node.name === 'CodeBlock') {
			code.push(node);
			return;
		}
		const opaqueKind: Partial<Record<string, ExclusionKind>> = {
			Image: 'image', URL: 'link-target', LinkTitle: 'link-target', LinkReference: 'link-target',
			HTMLBlock: 'html', HTMLTag: 'html', CommentBlock: 'html-comment', ProcessingInstructionBlock: 'html',
		};
		const kind = opaqueKind[node.name];
		if (kind) { opaque.push({node, kind}); return; }
		if (node.name === 'Paragraph' || node.name.startsWith('ATXHeading') || node.name === 'TableCell' || node.name.startsWith('SetextHeading')) prose.push(node);
		for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
	}
	visit(root);
	return {root, code, opaque, prose};
}

function nodeSpan(node: SyntaxNode): SourceSpan { return {start: node.from, end: node.to}; }
function overlaps(a: SourceSpan, b: SourceSpan): boolean { return a.start < b.end && b.start < a.end; }
function escaped(text: string, at: number): boolean {
	let count = 0;
	while (at > 0 && text[--at] === '\\') count++;
	return count % 2 === 1;
}

export function sourceLineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\r') {
			if (text[i + 1] === '\n') i++;
			starts.push(i + 1);
		} else if (text[i] === '\n') starts.push(i + 1);
	}
	return starts;
}

export function sourceLineAt(lineStarts: readonly number[], offset: number): number {
	let low = 0, high = lineStarts.length;
	while (low + 1 < high) {
		const mid = (low + high) >>> 1;
		if (lineStarts[mid] <= offset) low = mid;
		else high = mid;
	}
	return low;
}

function physicalLine(text: string, starts: readonly number[], line: number): {span: SourceSpan; lineEnding: SourceSpan} {
	const start = starts[line], next = starts[line + 1] ?? text.length;
	let end = next;
	if (end > start && text[end - 1] === '\n') end--;
	if (end > start && text[end - 1] === '\r') end--;
	return {span: {start, end}, lineEnding: {start: end, end: next}};
}

function frontmatterRegion(text: string, starts: readonly number[]): ExcludedSourceRegion | null {
	const first = physicalLine(text, starts, 0);
	if (!/^\uFEFF?---[ \t]*$/.test(text.slice(first.span.start, first.span.end))) return null;
	for (let line = 1; line < starts.length; line++) {
		const row = physicalLine(text, starts, line);
		if (/^(---|\.\.\.)[ \t]*$/.test(text.slice(row.span.start, row.span.end))) {
			return {kind: 'frontmatter', span: {start: 0, end: row.lineEnding.end}, closed: true};
		}
	}
	return {kind: 'frontmatter', span: {start: 0, end: text.length}, closed: false};
}

/** Non-whitespace placeholders avoid inventing indented code after a masked image/comment. */
function maskRegions(text: string, regions: readonly ExcludedSourceRegion[]): string {
	let result = '', from = 0;
	for (const region of regions) {
		result += text.slice(from, region.span.start);
		result += text.slice(region.span.start, region.span.end).replace(/[^\r\n]/g, '\uE000');
		from = region.span.end;
	}
	return result + text.slice(from);
}

function findDelimiter(text: string, delimiter: string, start: number): number {
	for (let found = text.indexOf(delimiter, start); found >= 0; found = text.indexOf(delimiter, found + delimiter.length)) {
		if (!escaped(text, found)) return found;
	}
	return -1;
}

/** Raw element contents cannot authorize a Markdown calculation from DOM code. */
const RAW_HTML_TAGS = new Set(['code', 'pre', 'script', 'style', 'textarea']);
function htmlTags(): RegExp {
	return /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/?([a-zA-Z][\w-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g;
}
function htmlRegion(text: string, at: number): ExcludedSourceRegion | null {
	const tag = /^<([a-zA-Z][\w-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(text.slice(at));
	if (!tag) return null;
	const name = tag[1].toLowerCase();
	if (!RAW_HTML_TAGS.has(name)) return {kind: 'html', span: {start: at, end: at + tag[0].length}, closed: true};
	const tags = htmlTags();
	tags.lastIndex = at + tag[0].length;
	let depth = 1;
	for (let next = tags.exec(text); next; next = tags.exec(text)) {
		if (!next[1] || next[1].toLowerCase() !== name) continue;
		if (next[0].startsWith('</')) depth--;
		else depth++; // Raw elements are nonvoid; a slash in their opener does not close them.
		if (depth === 0) return {kind: 'html', span: {start: at, end: tags.lastIndex}, closed: true};
	}
	return {kind: 'html', span: {start: at, end: text.length}, closed: false};
}

/** A nested raw opener can outlive the ordinary HTML block's blank-line boundary. */
function htmlBlockRegion(text: string, span: SourceSpan, blocks: readonly SourceSpan[]): ExcludedSourceRegion {
	let end = span.end, closed = true;
	let block = 0, upper = blocks.length;
	while (block < upper) {
		const middle = (block + upper) >>> 1;
		if (blocks[middle].end <= span.start) block = middle + 1;
		else upper = middle;
	}
	const includeIntersectedBlocks = (): void => {
		while (block < blocks.length && blocks[block].start < end) {
			const next = blocks[block++];
			if (next.end > span.start) end = Math.max(end, next.end);
		}
	};
	includeIntersectedBlocks();
	const tags = htmlTags();
	tags.lastIndex = span.start;
	for (let tag = tags.exec(text); tag && tag.index < end; tag = tags.exec(text)) {
		// Whole-tag matching keeps attributes, comments and CDATA opaque.
		if (!tag[1] || tag[0].startsWith('</') || !RAW_HTML_TAGS.has(tag[1].toLowerCase())) continue;
		const raw = htmlRegion(text, tag.index);
		if (!raw) continue;
		end = Math.max(end, raw.span.end);
		closed = closed && raw.closed;
		// A raw closing tag may start another structural HTML block. Never
		// erase its opener while leaving its following body available to reparse.
		includeIntersectedBlocks();
		tags.lastIndex = raw.span.end;
	}
	return {kind: 'html', span: {start: span.start, end}, closed};
}

function lexicalRegion(text: string, at: number, proseEnd?: number): ExcludedSourceRegion | null {
	if (escaped(text, at)) return null;
	for (const [opener, closer, kind] of [
		['%%', '%%', 'obsidian-comment'], ['<!--', '-->', 'html-comment'],
		['![[', ']]', 'embed'], ['[[', ']]', 'wikilink'],
	] as const) {
		if (!text.startsWith(opener, at)) continue;
		const end = kind === 'html-comment' ? text.indexOf(closer, at + opener.length) : findDelimiter(text, closer, at + opener.length);
		// An incomplete wikilink is prose, unlike an already-open comment.
		if (end < 0 && (kind === 'wikilink' || kind === 'embed')) return null;
		return {kind, span: {start: at, end: end < 0 ? text.length : end + closer.length}, closed: end >= 0};
	}
	if (text[at] === '<') return htmlRegion(text, at);
	if (text[at] !== '$' || text[at - 1] === '$') return null;
	const delimiter = text[at + 1] === '$' ? '$$' : '$';
	if (delimiter === '$' && (!text[at + 1] || /\s/.test(text[at + 1]))) return null;
	let close = findDelimiter(text, delimiter, at + delimiter.length);
	if (delimiter === '$') {
		while (close >= 0 && (/\s/.test(text[close - 1]) || text[close + 1] === '$')) close = findDelimiter(text, delimiter, close + 1);
		// Standalone parser paragraphs account for CR, quote/list prefixes,
		// headings and table cells. Raw whitespace regexes cannot define this boundary.
		if (close < 0 || proseEnd === undefined || close >= proseEnd) return null;
	}
	return {kind: 'math', span: {start: at, end: close < 0 ? text.length : close + delimiter.length}, closed: close >= 0};
}

/**
 * Discover exclusions in lexical order. A code node opened first is opaque;
 * a comment/raw-HTML/math region opened first consumes apparent code inside.
 * Reparse after new exclusions so hidden fences cannot suppress later prose.
 */
function exclusions(text: string, starts: readonly number[]): {nodes: ParsedNodes; regions: ExcludedSourceRegion[]; limitReached: boolean} {
	const frontmatter = frontmatterRegion(text, starts);
	const regions: ExcludedSourceRegion[] = frontmatter ? [frontmatter] : [];
	let nodes = parseNodes(maskRegions(text, regions));
	const maxPasses = 8;
	for (let pass = 0; pass < maxPasses; pass++) {
		const htmlBlocks = nodes.opaque.filter(({node}) => node.name === 'HTMLBlock').map(({node}) => nodeSpan(node));
		const structural = new Map<number, {end: number; name: string; kind?: ExclusionKind}>();
		for (const node of nodes.code) structural.set(node.from, {end: node.to, name: node.name});
		for (const {node, kind} of nodes.opaque) structural.set(node.from, {end: node.to, name: node.name, kind});
		const found: ExcludedSourceRegion[] = [];
		let prior = 0, prose = 0;
		for (let at = 0; at < text.length;) {
			while (prior < regions.length && regions[prior].span.end <= at) prior++;
			const existing = regions[prior];
			if (existing && existing.span.start <= at) { at = existing.span.end; continue; }
			const structuralNode = structural.get(at);
			if (structuralNode && !structuralNode.kind) { at = structuralNode.end; continue; }
			// An HTML block ends at its structural Markdown boundary, which can
			// extend beyond its closing tag. Masking only the element would expose
			// code that the host still treats as HTML (including following lines).
			if (structuralNode?.name === 'HTMLBlock') {
				// Raw elements additionally remain opaque until their own closing
				// tag, including a conservative EOF exclusion if it is missing.
				const region = htmlBlockRegion(text, {start: at, end: structuralNode.end}, htmlBlocks);
				found.push(region);
				at = region.span.end;
				continue;
			}
			while (prose < nodes.prose.length && nodes.prose[prose].to <= at) prose++;
			const proseEnd = nodes.prose[prose]?.from <= at ? nodes.prose[prose].to : undefined;
			const lexical = lexicalRegion(text, at, proseEnd);
			const region = lexical?.kind === 'html' ? htmlBlockRegion(text, lexical.span, htmlBlocks) : lexical;
			if (region) {
				found.push(region);
				at = region.span.end;
			} else if (structuralNode) {
				if (structuralNode.kind) found.push({kind: structuralNode.kind, span: {start: at, end: structuralNode.end}, closed: true});
				at = structuralNode.end;
			} else at++;
		}
		if (!found.length) return {nodes, regions, limitReached: false};
		regions.push(...found);
		regions.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
		// Newly found regions can enclose a previous masked region.
		for (let i = regions.length - 1; i > 0; i--) {
			if (regions[i - 1].span.end >= regions[i].span.start) {
				const before = regions[i - 1], after = regions[i];
				regions[i - 1] = {...before, span: {start: before.span.start, end: Math.max(before.span.end, after.span.end)}, closed: before.closed && after.closed};
				regions.splice(i, 1);
			}
		}
		nodes = parseNodes(maskRegions(text, regions));
	}
	return {nodes, regions, limitReached: true};
}

function columns(text: string, start: number, end: number, initial = 0): number {
	let col = initial;
	for (let i = start; i < end; i++) col += text[i] === '\t' ? 4 - col % 4 : 1;
	return col;
}

function containersFor(node: SyntaxNode, text: string, starts: readonly number[]): SourceContainer[] {
	const ancestors: SyntaxNode[] = [];
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (['Blockquote', 'ListItem', 'NumeralsFootnote'].includes(parent.name)) ancestors.unshift(parent);
	}
	const containers: SourceContainer[] = [];
	for (const parent of ancestors) {
		const markerName = parent.name === 'Blockquote' ? 'QuoteMark' : parent.name === 'ListItem' ? 'ListMark' : 'NumeralsFootnoteMark';
		const markerNode = parent.getChild(markerName);
		const marker = markerNode ? nodeSpan(markerNode) : null;
		let indentColumns = parent.name === 'NumeralsFootnote' ? 4 : 0;
		if (parent.name === 'ListItem' && marker) {
			const lineStart = starts[sourceLineAt(starts, marker.start)];
			let end = marker.end;
			while (text[end] === ' ' || text[end] === '\t') end++;
			const parentPrefix = stripContainers(text, physicalLine(text, starts, sourceLineAt(starts, marker.start)).span, containers);
			const markerCol = columns(text, lineStart, parentPrefix.start) - parentPrefix.extraSpaces;
			const afterCol = columns(text, lineStart, marker.end);
			const endCol = columns(text, lineStart, end);
			indentColumns = (endCol > afterCol && endCol < afterCol + 5 ? endCol : afterCol + 1) - markerCol;
		}
		containers.push({kind: parent.name === 'Blockquote' ? 'blockquote' : parent.name === 'ListItem' ? 'list-item' : 'footnote', span: nodeSpan(parent), marker, indentColumns});
	}
	return containers;
}

interface PrefixResult {
	readonly start: number;
	readonly extraSpaces: number;
	/** A quote's optional tab remains a literal byte when it is content. */
	readonly contentTab?: number;
}
function removeColumns(text: string, start: number, end: number, count: number, initialColumn: number): PrefixResult {
	let at = start, consumed = 0;
	while (at < end && consumed < count && (text[at] === ' ' || text[at] === '\t')) {
		consumed += text[at] === '\t' ? 4 - (initialColumn + consumed) % 4 : 1;
		at++;
	}
	return {start: at, extraSpaces: Math.max(0, consumed - count)};
}

function stripContainers(text: string, span: SourceSpan, containers: readonly SourceContainer[]): PrefixResult {
	let at = span.start;
	let extraSpaces = 0;
	let contentTab: number | undefined;
	const afterQuote = (mark: number): void => {
		// The marker consumes any pending virtual indentation before it. Its
		// optional following whitespace consumes exactly one column for locating
		// later containers. Retain a tab's source position if it remains content.
		at = mark + 1;
		extraSpaces = 0;
		contentTab = undefined;
		if (text[at] === '\t') {
			extraSpaces = 4 - columns(text, span.start, at) % 4 - 1;
			contentTab = at;
			at++;
		} else if (text[at] === ' ') at++;
	};
	for (const container of containers) {
		if (container.marker && container.marker.start >= span.start && container.marker.start < span.end) {
			const parentColumn = columns(text, span.start, at) - extraSpaces;
			at = container.marker.end;
			extraSpaces = 0;
			contentTab = undefined;
			if (container.kind === 'blockquote') afterQuote(container.marker.start);
			else if (container.kind === 'list-item') {
				const markerWidth = columns(text, span.start, container.marker.end) - parentColumn;
				const removed = removeColumns(text, at, span.end, container.indentColumns - markerWidth, columns(text, span.start, at));
				at = removed.start; extraSpaces = removed.extraSpaces;
			}
			continue;
		}
		if (container.kind === 'blockquote') {
			let mark = at, indentation = extraSpaces;
			while (indentation < 3 && mark < span.end && text[mark] === ' ') { mark++; indentation++; }
			if (text[mark] === '>') afterQuote(mark);
		} else if (extraSpaces >= container.indentColumns) {
			extraSpaces -= container.indentColumns;
			contentTab = undefined;
		} else {
			const removed = removeColumns(text, at, span.end, container.indentColumns - extraSpaces, columns(text, span.start, at));
			at = removed.start; extraSpaces = removed.extraSpaces;
			contentTab = undefined;
		}
	}
	return {start: at, extraSpaces, contentTab};
}

function rowProjection(text: string, span: SourceSpan, containers: readonly SourceContainer[], indent = 0): SourceProjection {
	const stripped = stripContainers(text, span, containers);
	let at = stripped.start, extraSpaces = stripped.extraSpaces;
	// Virtual columns are needed to find later container markers and strip
	// indentation. A tab still belonging to code content is copied literally,
	// matching the host's extracted text and retaining its one-byte mapping.
	if (indent === 0 && stripped.contentTab !== undefined) {
		at = stripped.contentTab;
		extraSpaces = 0;
	}
	if (indent > 0) {
		if (extraSpaces >= indent) extraSpaces -= indent;
		else {
			const removed = removeColumns(text, at, span.end, indent - extraSpaces, columns(text, span.start, at));
			at = removed.start; extraSpaces = removed.extraSpaces;
		}
	}
	const parts: ProjectionPart[] = [];
	if (at > span.start) parts.push({text: '', source: {start: span.start, end: at - (extraSpaces ? 1 : 0)}, kind: 'remove-prefix'});
	if (extraSpaces) parts.push({text: ' '.repeat(extraSpaces), source: {start: at - 1, end: at}, kind: 'expand-tab'});
	if (at < span.end) parts.push({text: text.slice(at, span.end), source: {start: at, end: span.end}});
	return createProjection(parts);
}

function inlineProjection(text: string, starts: readonly number[], span: SourceSpan, containers: readonly SourceContainer[]): SourceProjection {
	const parts: SourceProjection[] = [];
	const firstLine = sourceLineAt(starts, span.start), lastLine = sourceLineAt(starts, Math.max(span.start, span.end - 1));
	for (let line = firstLine; line <= lastLine; line++) {
		const row = physicalLine(text, starts, line);
		const body = {start: Math.max(span.start, row.span.start), end: Math.min(span.end, row.span.end)};
		if (body.start <= body.end) parts.push(rowProjection(text, body, line === firstLine ? [] : containers));
		const newline = {start: Math.max(span.start, row.lineEnding.start), end: Math.min(span.end, row.lineEnding.end)};
		if (newline.start < newline.end) parts.push(createProjection([{text: ' ', source: newline, kind: 'normalize-newline'}]));
	}
	const projection = joinProjections(parts);
	// CommonMark removes exactly one paired ASCII space unless all content is spaces.
	if (projection.text.startsWith(' ') && projection.text.endsWith(' ') && /[^ ]/.test(projection.text)) {
		const first = sliceProjection(projection, 0, 1), last = sliceProjection(projection, projection.text.length - 1);
		return joinProjections([
			{text: '', segments: first.segments.map(segment => ({...segment, kind: 'remove-padding', target: {start: 0, end: 0}}))},
			sliceProjection(projection, 1, projection.text.length - 1),
			{text: '', segments: last.segments.map(segment => ({...segment, kind: 'remove-padding', target: {start: 0, end: 0}}))},
		]);
	}
	return projection;
}

function occurrenceId(source: NoteSource, kind: 'block' | 'inline', span: SourceSpan): string {
	return JSON.stringify([source.sourceId, source.revision, kind, span.start, span.end]);
}

function activeTriggers(policy: SourceSyntaxPolicy, diagnostics: SourceIndexDiagnostic[]): InlineTrigger[] {
	const triggers: InlineTrigger[] = [], seen = new Set<string>();
	for (const trigger of policy.triggers ?? DEFAULT_TRIGGERS) {
		if (!trigger.trigger) continue;
		if (seen.has(trigger.trigger)) {
			diagnostics.push({code: 'duplicate-trigger', span: {start: 0, end: 0}, message: `Duplicate inline trigger ${JSON.stringify(trigger.trigger)}; this trigger is disabled.`});
			const prior = triggers.findIndex(candidate => candidate.trigger === trigger.trigger);
			if (prior >= 0) triggers.splice(prior, 1);
		} else { seen.add(trigger.trigger); triggers.push({...trigger}); }
	}
	return triggers.sort((a, b) => b.trigger.length - a.trigger.length);
}

/**
 * Lezer can disagree with host boundaries for quoted-tab openers and unclosed
 * quote fences, or terminate a fence early when container tabs leave virtual
 * columns. The remaining body may then appear as ordinary inline code. A
 * language-independent guard must run before extracting any calculations.
 * This only inspects parser nodes and their original container extents; it does
 * not guess a replacement Markdown structure or a closing-fence position.
 */
function ambiguousContainerFences(nodes: ParsedNodes, text: string, starts: readonly number[]): SyntaxNode[] {
	return nodes.code.filter(node => {
		if (node.name !== 'FencedCode') return false;
		const containers = containersFor(node, text, starts);
		if (!containers.length) return false;
		const lineStart = starts[sourceLineAt(starts, node.from)];
		const prefix = text.slice(lineStart, node.from);
		const quoted = containers.some(container => container.kind === 'blockquote');
		if (quoted && prefix.includes('\t')) return true;
		if (node.getChildren('CodeMark').length !== 1) return false;
		return quoted || prefix.includes('\t') ||
			containers.some(container => text.slice(container.span.start, container.span.end).includes('\t'));
	});
}

/** Pure, complete-source indexing. No host/editor tree, evaluation or metadata reads. */
export function indexNote(source: NoteSource, policy: SourceSyntaxPolicy = {}): NoteSourceIndex {
	const text = source.text, lineStarts = sourceLineStarts(text);
	const diagnostics: SourceIndexDiagnostic[] = [];
	const triggers = policy.inlineEnabled === false ? [] : activeTriggers(policy, diagnostics);
	const {nodes, regions, limitReached} = exclusions(text, lineStarts);
	if (limitReached) diagnostics.push({code: 'exclusion-limit', span: {start: 0, end: text.length}, message: 'Obsidian exclusion parsing did not converge; calculations are withheld for this source revision.'});
	for (const region of regions) if (!region.closed) diagnostics.push({code: 'unclosed-region', span: region.span, message: `Unclosed ${region.kind} region is conservatively excluded through the end of the source.`});
	const ambiguousFences = ambiguousContainerFences(nodes, text, lineStarts);
	for (const node of ambiguousFences) diagnostics.push({code: 'ambiguous-container', span: nodeSpan(node),
		message: 'A fenced block has an ambiguous quoted or tab-indented container boundary. Note evaluation is withheld; use spaces for container indentation and close the fence explicitly.'});
	const evaluationBlocked = limitReached || ambiguousFences.length > 0;
	const calculations: CalculationSource[] = [], suggestionRegions: SuggestionRegion[] = [];
	const excludedRegions = [...regions];
	for (const node of evaluationBlocked ? [] : nodes.code) {
		if (regions.some(region => overlaps(region.span, nodeSpan(node)))) continue;
		const span = nodeSpan(node), marks = node.getChildren('CodeMark');
		if (node.name === 'CodeBlock' || marks.length === 0) {
			excludedRegions.push({kind: 'code', span, closed: true});
			continue;
		}
		const opener = nodeSpan(marks[0]), closer = marks.length > 1 ? nodeSpan(marks[marks.length - 1]) : null;
		const containers = containersFor(node, text, lineStarts);
		if (node.name === 'InlineCode') {
			if (!closer) continue;
			const projection = inlineProjection(text, lineStarts, {start: opener.end, end: closer.start}, containers);
			suggestionRegions.push({span, opener, closer, projection});
			const trigger = triggers.find(candidate => projection.text.startsWith(candidate.trigger));
			if (!trigger || !projection.text.slice(trigger.trigger.length).trim()) continue;
			calculations.push({id: occurrenceId(source, 'inline', span), kind: 'inline', span, opener, closer, closed: true, containers,
				projection, ...trigger, expression: sliceProjection(projection, trigger.trigger.length)});
			continue;
		}
		const info = node.getChild('CodeInfo');
		const rawInfo = info ? text.slice(info.from, info.to).replace(/\r$/, '') : '';
		const language = rawInfo.split(/[ \t]/, 1)[0].toLowerCase();
		if (!(NUMERALS_BLOCK_LANGUAGES as readonly string[]).includes(language)) {
			excludedRegions.push({kind: 'code', span, closed: closer !== null});
			continue;
		}
		const openerLine = sourceLineAt(lineStarts, opener.start);
		const openerRow = physicalLine(text, lineStarts, openerLine);
		const base = stripContainers(text, openerRow.span, containers);
		const indent = Math.max(0, columns(text, openerRow.span.start, opener.start) - columns(text, openerRow.span.start, base.start) + base.extraSpaces);
		const endLine = closer ? sourceLineAt(lineStarts, closer.start) : sourceLineAt(lineStarts, Math.max(node.from, node.to - 1)) + 1;
		const rows: PhysicalBlockRow[] = [];
		for (let line = openerLine + 1; line < endLine; line++) {
			const row = physicalLine(text, lineStarts, line);
			rows.push({line, ...row, projection: rowProjection(text, row.span, containers, indent)});
		}
		const body: SourceProjection[] = [];
		for (let i = 0; i < rows.length; i++) {
			body.push(rows[i].projection);
			if (i < rows.length - 1) body.push(createProjection([{text: '\n', source: rows[i].lineEnding, kind: text.slice(rows[i].lineEnding.start, rows[i].lineEnding.end) === '\n' ? 'copy' : 'normalize-newline'}]));
		}
		calculations.push({id: occurrenceId(source, 'block', span), kind: 'block', span, opener, closer, closed: closer !== null, containers,
			language: language as NumeralsBlockLanguage, rawInfo, rows, projection: joinProjections(body)});
		if (!closer) diagnostics.push({code: 'unclosed-region', span, message: 'Unclosed Numerals fence extends to its structural source boundary. Close the fence explicitly to bound its calculation body.'});
	}
	calculations.sort((a, b) => a.span.start - b.span.start);
	excludedRegions.sort((a, b) => a.span.start - b.span.start);
	return {source: {...source}, calculations, excludedRegions, diagnostics, lineStarts, compatibility: 'obsidian-1.13.7-linux-fixtures', evaluationBlocked,
		suggestionRegions, proseRegions: evaluationBlocked ? [] : nodes.prose.map(nodeSpan), triggers};
}

/** A tolerant suggestion lookup cannot add evaluation occurrences or export values. */
export function findSuggestionContext(index: NoteSourceIndex, cursor: number): InlineSuggestionContext | null {
	if (cursor < 0 || cursor > index.source.text.length || !index.triggers.length) return null;
	const complete = index.suggestionRegions.find(region => cursor >= region.opener.end && cursor <= (region.closer?.start ?? region.span.end));
	if (complete) {
		const trigger = index.triggers.find(candidate => complete.projection.text.startsWith(candidate.trigger));
		return trigger ? {kind: 'complete', span: complete.span, opener: complete.opener, closer: complete.closer, trigger: trigger.trigger,
			expression: sliceProjection(complete.projection, trigger.trigger.length)} : null;
	}
	const prose = index.proseRegions.find(region => region.start <= cursor && region.end >= cursor);
	if (!prose || index.excludedRegions.some(region => region.span.start <= cursor && region.span.end >= cursor)) return null;
	const text = index.source.text;
	let opener: SourceSpan | null = null;
	for (let at = prose.start; at < cursor;) {
		const excluded = index.excludedRegions.find(region => region.span.start <= at && region.span.end > at);
		const code = index.suggestionRegions.find(region => region.span.start <= at && region.span.end > at);
		if (excluded || code) { at = (excluded?.span ?? code!.span).end; opener = null; continue; }
		if (text[at] !== '`' || escaped(text, at)) { at++; continue; }
		let end = at + 1;
		while (text[end] === '`') end++;
		if (!opener) opener = {start: at, end};
		else if (end - at === opener.end - opener.start) opener = null;
		at = end;
	}
	if (!opener || opener.end > cursor) return null;
	// A prose node starts after its first-line container prefix. Continuation
	// prefixes are recovered from the same parser node used for evaluation.
	const parsed = parseNodes(maskRegions(text, index.excludedRegions.filter(region => region.kind !== 'code')));
	const proseNode = parsed.prose.find(node => node.from === prose.start && node.to === prose.end);
	const containers = proseNode ? containersFor(proseNode, text, index.lineStarts) : [];
	const projection = inlineProjection(text, index.lineStarts, {start: opener.end, end: cursor}, containers);
	const trigger = index.triggers.find(candidate => projection.text.startsWith(candidate.trigger));
	return trigger ? {kind: 'unfinished', span: {start: opener.start, end: cursor}, opener, closer: null, trigger: trigger.trigger,
		expression: sliceProjection(projection, trigger.trigger.length)} : null;
}
