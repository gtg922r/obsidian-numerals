/** Original-source and projection offsets are JavaScript UTF-16 offsets. */
export interface SourceSpan {
	readonly start: number;
	readonly end: number;
}

export type ProjectionKind = 'copy' | 'normalize-newline' | 'remove-prefix' | 'remove-padding' | 'expand-tab';

export interface ProjectionSegment {
	readonly kind: ProjectionKind;
	readonly source: SourceSpan;
	readonly target: SourceSpan;
}

/** A projection never changes the authoritative source or hides its removed prefixes. */
export interface SourceProjection {
	readonly text: string;
	readonly segments: readonly ProjectionSegment[];
}

export interface ProjectionPart {
	readonly text: string;
	readonly source: SourceSpan;
	readonly kind?: ProjectionKind;
}

export function createProjection(parts: readonly ProjectionPart[]): SourceProjection {
	let text = '';
	const segments: ProjectionSegment[] = [];
	for (const part of parts) {
		const start = text.length;
		text += part.text;
		segments.push({kind: part.kind ?? 'copy', source: {...part.source}, target: {start, end: text.length}});
	}
	return {text, segments};
}

export function sliceProjection(projection: SourceProjection, start: number, end = projection.text.length): SourceProjection {
	if (start < 0 || end < start || end > projection.text.length) throw new RangeError('Invalid projection range');
	const segments: ProjectionSegment[] = [];
	for (const segment of projection.segments) {
		const from = Math.max(start, segment.target.start);
		const to = Math.min(end, segment.target.end);
		if (segment.target.start === segment.target.end) {
			if (segment.target.start >= start && segment.target.start <= end) {
				segments.push({...segment, target: {start: segment.target.start - start, end: segment.target.end - start}});
			}
		} else if (from < to) {
			const source = segment.kind === 'copy'
				? {start: segment.source.start + from - segment.target.start, end: segment.source.start + to - segment.target.start}
				: {...segment.source};
			segments.push({...segment, source, target: {start: from - start, end: to - start}});
		}
	}
	return {text: projection.text.slice(start, end), segments};
}

export function joinProjections(projections: readonly SourceProjection[]): SourceProjection {
	let text = '';
	const segments: ProjectionSegment[] = [];
	for (const projection of projections) {
		const offset = text.length;
		text += projection.text;
		segments.push(...projection.segments.map(segment => ({...segment, target: {
			start: segment.target.start + offset, end: segment.target.end + offset,
		}})));
	}
	return {text, segments};
}

/** Returns only contributing source spans, never the bounding span across removed markup. */
export function sourceSpansForRange(projection: SourceProjection, start: number, end: number): SourceSpan[] {
	const sliced = sliceProjection(projection, start, end);
	const spans: SourceSpan[] = [];
	for (const segment of sliced.segments) {
		if (segment.target.end === segment.target.start) continue;
		const last = spans[spans.length - 1];
		if (last && last.end === segment.source.start) spans[spans.length - 1] = {start: last.start, end: segment.source.end};
		else if (!last || last.start !== segment.source.start || last.end !== segment.source.end) spans.push({...segment.source});
	}
	return spans;
}

/**
 * A conservative edit helper: transformed characters, empty ranges and removed
 * markup are not safe single-span replacements. Host identity/revision checks
 * are additionally required before applying any returned span.
 */
export function contiguousSourceSpan(projection: SourceProjection, start: number, end: number): SourceSpan | null {
	if (start === end) return null;
	const sliced = sliceProjection(projection, start, end);
	if (sliced.segments.some(segment => segment.target.end > segment.target.start && segment.kind !== 'copy')) return null;
	const spans = sourceSpansForRange(projection, start, end);
	return spans.length === 1 ? spans[0] : null;
}
