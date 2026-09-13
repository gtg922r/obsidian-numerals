import type { MarkdownSectionInformation } from 'obsidian';
import type { CalculationSource, NoteSourceIndex } from '../evaluation/sourceIndex';
import type { SourceSpan } from '../evaluation/sourceProjection';
import { sanitizeHTMLToDom } from 'obsidian';

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');
const payload = (text: string) => normalize(text).replace(/\n$/, '');

/** Validate host section evidence against the complete source before selecting occurrences. */
export function sectionSourceSpan(index: NoteSourceIndex, section: MarkdownSectionInformation | null): SourceSpan | undefined {
	if (!section || !Number.isInteger(section.lineStart) || !Number.isInteger(section.lineEnd) ||
		section.lineStart < 0 || section.lineEnd < section.lineStart) return;
	const text = index.source.text, full = normalize(text), host = normalize(section.text);
	let first = section.lineStart, last = section.lineEnd;
	if (full !== host && full.replace(/^\uFEFF/, '') !== host) {
		// Section-only embeds carry target snippets, not the host note. Require a
		// unique complete sequence of physical target lines; equal snippets are ambiguous.
		const lines = full.split('\n'), snippet = payload(host).split('\n');
		const matches: number[] = [];
		for (let at = 0; at + snippet.length <= lines.length; at++) {
			if (snippet.every((line, offset) => line === lines[at + offset])) matches.push(at);
		}
		if (matches.length !== 1) return;
		first = matches[0]; last = first + snippet.length - 1;
	}
	if (first >= index.lineStarts.length || last >= index.lineStarts.length) return;
	const start = index.lineStarts[first], end = index.lineStarts[last + 1] ?? text.length;
	return {start, end};
}

export function calculationsInSection(index: NoteSourceIndex, section: MarkdownSectionInformation | null): readonly CalculationSource[] {
	const span = sectionSourceSpan(index, section);
	return span ? index.calculations.filter(calculation => calculation.span.start >= span.start && calculation.span.end <= span.end) : [];
}

interface RenderedCodeSource { readonly text: string; readonly calculation?: CalculationSource; readonly start: number }

function renderedCodes(index: NoteSourceIndex, span: SourceSpan): RenderedCodeSource[] {
	const codes: RenderedCodeSource[] = index.suggestionRegions.filter(region => region.span.start >= span.start && region.span.end <= span.end)
		.map(region => ({text: region.projection.text, start: region.span.start,
			calculation: index.calculations.find(calculation => calculation.kind === 'inline' &&
				calculation.span.start === region.span.start && calculation.span.end === region.span.end)}));
	const html: {start: number; end: number}[] = [];
	for (const region of index.excludedRegions.filter(region => region.kind === 'html').sort((a, b) => a.span.start - b.span.start)) {
		const previous = html.at(-1);
		if (previous && region.span.start < previous.end) previous.end = Math.max(previous.end, region.span.end);
		else html.push({...region.span});
	}
	for (const region of html) {
		if (region.start < span.start || region.end > span.end) continue;
		// Placeholders preserve raw HTML's DOM ordinal. They can never become F
		// calculations, even if their text equals a legitimate Markdown code span.
		const fragment = sanitizeHTMLToDom(index.source.text.slice(region.start, region.end));
		for (const code of Array.from(fragment.querySelectorAll('code')).filter(code => !code.closest('pre'))) {
			codes.push({text: code.textContent ?? '', start: region.start});
		}
	}
	return codes.sort((left, right) => left.start - right.start);
}

const sameSequence = (codes: readonly RenderedCodeSource[], sources: readonly string[]) =>
	codes.length === sources.length && codes.every((code, ordinal) => code.text === sources[ordinal]);

/** Read-only projection grouping over F's existing regions, never an evaluation parser. */
function footnoteGroups(index: NoteSourceIndex): SourceSpan[] {
	const groups = new Map<string, SourceSpan>();
	for (const calculation of index.calculations) {
		for (const container of calculation.containers) {
			if (container.kind === 'footnote') groups.set(JSON.stringify(container.span), container.span);
		}
	}
	const source = index.source.text;
	const protectedSpans = [...index.excludedRegions.map(region => region.span), ...index.suggestionRegions.map(region => region.span)];
	for (const prose of index.proseRegions) {
		for (let at = prose.start; at < prose.end - 1; at++) {
			const protectedSpan = protectedSpans.find(span => span.start <= at && at < span.end);
			if (protectedSpan) { at = protectedSpan.end - 1; continue; }
			if (source.slice(at, at + 2) !== '^[') continue;
			let slash = at - 1; while (source[slash] === '\\') slash--;
			if ((at - 1 - slash) % 2) continue;
			let depth = 1, end = at + 2, ambiguous = false;
			for (; end < prose.end; end++) {
				const opaque = protectedSpans.find(span => span.start <= end && end < span.end);
				if (opaque) { end = opaque.end - 1; continue; }
				if (source[end] === '\\') { end++; continue; }
				if (source.slice(end, end + 2) === '^[') ambiguous = true;
				if (source[end] === '[') depth++;
				if (source[end] === ']' && --depth === 0) break;
			}
			if (depth === 0 && !ambiguous) groups.set(`${at}:${end + 1}`, {start: at + 2, end});
			at = end;
		}
	}
	return [...groups.values()];
}

/** All code nodes in the actual section participate, including unprocessed and excluded nodes. */
export function bindReadingCodes(index: NoteSourceIndex, section: MarkdownSectionInformation | null,
	sources: readonly string[], footnote?: {lineDelta: string | null; bodyId: string | null; docId: string}): readonly (CalculationSource | undefined)[] | undefined {
	if (footnote) {
		if (!section || normalize(section.text) !== normalize(index.source.text)) return;
		const physical = sectionSourceSpan(index, section);
		// Author-written HTML may imitate the native footnote tree and attributes.
		// Physical excluded HTML remains ordinal placeholders, never footnote identity.
		if (physical && index.excludedRegions.some(region => region.kind === 'html' &&
			region.span.start < physical.end && region.span.end > physical.start)) {
			const codes = renderedCodes(index, physical);
			return sameSequence(codes, sources) ? codes.map(code => code.calculation) : undefined;
		}
		let sourceLine: number | undefined;
		if (footnote.lineDelta !== null) {
			if (!/^-?(?:0|[1-9]\d*)$/.test(footnote.lineDelta)) return;
			const delta = Number(footnote.lineDelta);
			if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(section.lineStart)) return;
			sourceLine = section.lineStart + delta;
			if (!Number.isSafeInteger(sourceLine) || sourceLine < 0 || sourceLine >= index.lineStarts.length) return;
			const rawId = footnote.bodyId ?? '';
			const id = footnote.docId && rawId.endsWith(`-${footnote.docId}`) ? rawId.slice(0, -footnote.docId.length - 1) : rawId;
			if (!/^fn-[1-9]\d*$/.test(id)) return;
		}
		const matches = footnoteGroups(index).filter(span => sourceLine === undefined ||
			(span.start >= index.lineStarts[sourceLine] && span.start < (index.lineStarts[sourceLine + 1] ?? index.source.text.length + 1)))
			.map(span => renderedCodes(index, span)).filter(codes => sameSequence(codes, sources));
		return matches.length === 1 ? matches[0].map(code => code.calculation) : undefined;
	}
	const span = sectionSourceSpan(index, section);
	if (!span) return;
	const codes = renderedCodes(index, span);
	return sameSequence(codes, sources) ? codes.map(code => code.calculation) : undefined;
}

export function bindBlock(index: NoteSourceIndex, section: MarkdownSectionInformation | null,
	source: string): CalculationSource | undefined {
	const candidates = calculationsInSection(index, section).filter(calculation => calculation.kind === 'block' &&
		payload(calculation.projection.text) === payload(source));
	return candidates.length === 1 ? candidates[0] : undefined;
}

/** DOM order is used only within one validated host section, including identical occurrences. */
export function bindInlineSection(index: NoteSourceIndex, section: MarkdownSectionInformation | null,
	sources: readonly string[]): readonly CalculationSource[] | undefined {
	const candidates = calculationsInSection(index, section).filter(calculation => calculation.kind === 'inline');
	if (candidates.length !== sources.length || candidates.some((calculation, ordinal) => calculation.projection.text !== sources[ordinal])) return;
	return candidates;
}
