/** UTF-16 offsets, end exclusive; relative to the expression/block, not the note. */
export interface SourceSpan { start: number; end: number }
export interface SourceEdit extends SourceSpan { text: string }
export interface SourceMapping { kind: 'identity' | 'replacement'; generated: SourceSpan; original: SourceSpan }
export interface MappedSource {
	originalSource: string;
	source: string;
	mappings: SourceMapping[];
}

export function originalSource(source: string): MappedSource {
	return { originalSource: source, source, mappings: [{ kind: 'identity', generated: { start: 0, end: source.length }, original: { start: 0, end: source.length } }] };
}

/** Replacements map to the entire original token; untouched text maps exactly. */
export function mapSourceSpan(mapped: MappedSource, span: SourceSpan): SourceSpan {
	const parts = mapped.mappings.filter(m => m.generated.end > span.start && m.generated.start < span.end);
	const point = (m: SourceMapping, offset: number) => m.kind === 'identity'
		? m.original.start + offset - m.generated.start : undefined;
	if (span.start < 0 || span.end < span.start || span.end > mapped.source.length) throw new Error('Invalid source span');
	if (span.start === span.end) {
		const m = mapped.mappings.find(m => m.generated.start <= span.start && m.generated.end > span.start);
		if (!m) return { start: mapped.originalSource.length, end: mapped.originalSource.length };
		const offset = point(m, span.start);
		return offset === undefined ? { ...m.original } : { start: offset, end: offset };
	}
	if (parts.length === 0) return { start: mapped.originalSource.length, end: mapped.originalSource.length };
	const first = parts[0], last = parts[parts.length - 1];
	return {
		start: point(first, Math.max(span.start, first.generated.start)) ?? first.original.start,
		end: point(last, Math.min(span.end, last.generated.end)) ?? last.original.end,
	};
}

/** Compose ordered, non-overlapping edits with an existing extraction/normalization map. */
export function applySourceEdits(mapped: MappedSource, edits: readonly SourceEdit[]): MappedSource {
	let source = '', cursor = 0;
	const mappings: SourceMapping[] = [];
	const append = (text: string, original: SourceSpan, kind: SourceMapping['kind']) => {
		if (text.length) mappings.push({ kind, generated: { start: source.length, end: source.length + text.length }, original });
		source += text;
	};
	const unchanged = (start: number, end: number) => {
		for (const mapping of mapped.mappings) {
			const span = { start: Math.max(start, mapping.generated.start), end: Math.min(end, mapping.generated.end) };
			if (span.start < span.end) append(mapped.source.slice(span.start, span.end), mapSourceSpan(mapped, span), mapping.kind);
		}
	};
	for (const edit of edits) {
		if (edit.start < cursor || edit.end < edit.start || edit.end > mapped.source.length) throw new Error('Overlapping or invalid source edit');
		unchanged(cursor, edit.start);
		append(edit.text, mapSourceSpan(mapped, edit), 'replacement');
		cursor = edit.end;
	}
	unchanged(cursor, mapped.source.length);
	return { originalSource: mapped.originalSource, source, mappings };
}

export const CROSS_NOTE_REF_REGEX = /\[\[([^\]\r\n]+)\]\]\.([$\w\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F]+(?:\.[$\w\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F]+)*)/g;
/** Exact spans in the supplied source; no stored value bytes are interpreted or normalized. */
export interface InsertionSpan extends SourceSpan {
	/** Everything between the outer brackets, including the optional :: separator. */
	contentSpan: SourceSpan;
	/** The expression before ::, or all content when there is no stored value. */
	expressionSpan: SourceSpan;
	/** Stored bytes after :: and before the outer ]; present even for an empty value. */
	valueSpan?: SourceSpan;
}

/**
 * Read one single-line insertion wrapper, balancing nested delimiters and strings.
 * This only locates the wrapper; mathjs still parses the extracted expression.
 */
export function readInsertion(source: string, start = 0): InsertionSpan | undefined {
	if (!Number.isInteger(start) || start < 0 || source[start] !== '@') return undefined;
	let index = start + 1;
	while (source[index] === ' ' || source[index] === '\t') index++;
	if (source[index] !== '[') return undefined;
	const contentStart = ++index;
	const closes: string[] = [];
	let expressionEnd: number | undefined, valueStart: number | undefined;
	let endsValue = false, property = false;
	while (index < source.length) {
		const char = source[index];
		if (char === '\r' || char === '\n') return undefined;
		// Note labels are opaque: their parentheses and quotes are not math syntax.
		const reference = valueStart === undefined && source.startsWith('[[', index)
			? new RegExp('^' + CROSS_NOTE_REF_REGEX.source).exec(source.slice(index)) : null;
		if (reference) {
			index += reference[0].length;
			endsValue = true;
			property = false;
			continue;
		}
		if (char === '"' || (char === "'" && !endsValue)) {
			const quote = char;
			let closed = false;
			index++;
			while (index < source.length) {
				const quoted = source[index++];
				if (quoted === '\r' || quoted === '\n') return undefined;
				if (quoted === '\\') {
					if (index === source.length || source[index] === '\r' || source[index] === '\n') return undefined;
					index++;
				} else if (quoted === quote) { closed = true; break; }
			}
			if (!closed) return undefined;
			endsValue = true;
			property = false;
			continue;
		}
		if (char === ']' && closes.length === 0) {
			const expressionSpan = { start: contentStart, end: expressionEnd ?? index };
			if (expressionSpan.start === expressionSpan.end) return undefined;
			return {
				start, end: index + 1,
				contentSpan: { start: contentStart, end: index }, expressionSpan,
				...(valueStart === undefined ? {} : { valueSpan: { start: valueStart, end: index } }),
			};
		}
		if (char === ':' && closes.length === 0 && valueStart === undefined) {
			if (source[index + 1] !== ':') return undefined;
			expressionEnd = index;
			index += 2;
			valueStart = index;
			endsValue = false;
			property = false;
			continue;
		}
		// Only delimiter boundaries matter here, not whether mathjs accepts a name.
		// In particular, letter-like symbols such as ℘ also precede transpose quotes.
		const atom = /^[^\s[\](){}"'+\-*/\\%^=<>?:&|~,;.!]+/u.exec(source.slice(index))?.[0];
		if (atom) {
			endsValue = property || !/^(and|or|xor|not|mod|to|in)$/.test(atom);
			property = false;
			index += atom.length;
			continue;
		}
		if (char === '[' || char === '(' || char === '{') {
			closes.push(char === '[' ? ']' : char === '(' ? ')' : '}');
			endsValue = false;
		} else if (char === ']' || char === ')' || char === '}') {
			if (closes.pop() !== char) return undefined;
			endsValue = true;
		} else if (!/\s/.test(char)) {
			// Match the scanner's quote/transpose distinction without parsing math.
			// Names and numeric leaves end a value; operators start the next one.
			if (char !== "'" && char !== '!') endsValue = /\d/.test(char);
		}
		if (!/\s/.test(char)) property = char === '.';
		index++;
	}
	return undefined;
}

export interface ExpressionToken extends SourceSpan {
	kind: 'string' | 'comment' | 'reference' | 'number' | 'currency' | 'identifier' | 'syntax' | 'directive' | 'insertion' | 'emitter';
	text: string;
	currencySymbol?: string;
	/** Empty for a standalone conversion/unit symbol. */
	currencyAmount?: string;
	/** Present for insertion tokens; all child spans use source-absolute offsets. */
	insertion?: InsertionSpan;
	/** No surrounding call, array, index or object; only grouping parentheses are allowed. */
	groupingAllowed: boolean;
}
const identifier = /^[$\p{Sc}\p{L}_][\p{Sc}\p{L}\p{N}_$]*/u;
const number = /^(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const completeNumber = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const groupedNumber = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function normalizeNumericToken(value: string, allowGrouping: boolean): string | undefined {
	if (completeNumber.test(value)) return value;
	if (allowGrouping && groupedNumber.test(value)) return value.replace(/,/g, '');
	return undefined;
}

/** Consume malformed numeric tails too, so a valid prefix is never rewritten. */
function readNumericCandidate(tail: string, delimiters: boolean): string | undefined {
	let candidate = number.exec(tail)?.[0];
	if (!candidate) return undefined;
	if (delimiters && /[^,],$/.test(candidate)) candidate = candidate.slice(0, -1);
	let rest = tail.slice(candidate.length);
	if (/^[eE]/.test(rest)) {
		candidate += /^[eE][+-]?\d*/.exec(rest)![0];
		rest = tail.slice(candidate.length);
	}
	if (/^\.\d/.test(rest) || (!delimiters && /^,/.test(rest))) {
		candidate += /^[.,\d]+/.exec(rest)![0];
	}
	return candidate;
}

/** A lexical extension pass only. Mathjs owns grammar, precedence, and evaluation. */
export function scanExpression(source: string, currencySymbols: readonly string[] = []): ExpressionToken[] {
	const tokens: ExpressionToken[] = [];
	const frames: { close: string; delimiter: boolean; callableAfter: boolean }[] = [];
	let index = 0, endsValue = false, callable = false;
	let previous: ExpressionToken | undefined;
	const symbols = [...currencySymbols].filter(Boolean).sort((a, b) => b.length - a.length);
	while (index < source.length) {
		const start = index, tail = source.slice(index), char = source[index];
		if (/\s/.test(char)) {
			if (char === '\n' && frames.length === 0) { endsValue = false; callable = false; previous = undefined; }
			index++; continue;
		}
		let kind: ExpressionToken['kind'] = 'syntax';
		let text = char;
		let currencySymbol: string | undefined, currencyAmount: string | undefined;
		let insertion: InsertionSpan | undefined;
		const readSymbol = (input: string) => symbols.find(symbol => input.startsWith(symbol)) ?? /^\p{Sc}/u.exec(input)?.[0];
		const currency = readSymbol(tail);
		const ref = tail.startsWith('[[') ? new RegExp('^' + CROSS_NOTE_REF_REGEX.source).exec(tail) : null;
		if (char === '"' || (char === "'" && !endsValue)) {
			kind = 'string'; index++;
			while (index < source.length) {
				if (source[index] === '\\') { index += 2; continue; }
				if (source[index++] === char) break;
			}
			index = Math.min(index, source.length);
			text = source.slice(start, index);
		} else if (char === '#') {
			kind = 'comment'; text = tail.split('\n')[0];
		} else if (ref) {
			kind = 'reference'; text = ref[0];
		} else if (tail.startsWith('?.') && !/\d/.test(tail[2] ?? '')) {
			text = '?.';
		} else if (tail.startsWith('=>')) {
			kind = 'emitter'; text = tail.split('\n')[0];
		} else if (char === '@' && (insertion = readInsertion(source, start))) {
			kind = 'insertion'; text = source.slice(start, insertion.end);
		} else if (/^@(sum|total|prev)\b/i.test(tail)) {
			kind = 'directive'; text = /^@(sum|total|prev)\b/i.exec(tail)![0];
		} else {
			const delimiters = frames.some(frame => frame.delimiter);
			const amount = currency ? readNumericCandidate(tail.slice(currency.length), delimiters) : undefined;
			const numeric = readNumericCandidate(tail, delimiters);
			const name = identifier.exec(tail)?.[0];
			// Object keys and dotted accessors name properties, not currency values.
			const identifierRole = previous?.text === '.' || previous?.text === '?.' ||
				(frames[frames.length - 1]?.close === '}' && (previous?.text === '{' || previous?.text === ','));
			const suffixTail = numeric ? tail.slice(numeric.length).replace(/^[\t ]+/, '') : '';
			const suffix = readSymbol(suffixTail);
			const isWholeSymbol = (input: string, symbol: string) => !/^[\p{Sc}\p{L}\p{N}_$]/u.test(input.slice(symbol.length));
			if (name && identifierRole) { kind = 'identifier'; text = name; }
			else if (amount && !/^[\p{Sc}\p{L}\p{N}_$]/u.test(tail.slice(currency!.length + amount.length))) { kind = 'currency'; text = currency + amount; currencySymbol = currency; currencyAmount = amount; }
			else if (numeric && (!delimiters || !numeric.includes(',')) && suffix && isWholeSymbol(suffixTail, suffix)) {
				kind = 'currency'; text = tail.slice(0, tail.length - suffixTail.length + suffix.length);
				currencySymbol = suffix; currencyAmount = numeric;
			} else if (numeric) { kind = 'number'; text = numeric; }
			else if (currency && isWholeSymbol(tail, currency)) {
				kind = 'currency'; text = currency; currencySymbol = currency; currencyAmount = '';
			} else if (name) { kind = 'identifier'; text = name; }
		}
		index = start + text.length;
		const token = { start, end: index, kind, text, currencySymbol, currencyAmount, insertion, groupingAllowed: !frames.some(frame => frame.delimiter) };
		tokens.push(token);
		if (kind === 'comment' || kind === 'emitter') continue;
		if (kind === 'syntax') {
			if (char === '(' || char === '[' || char === '{') {
				// Mathjs calls only symbols/accessors (or an explicit optional call).
				// Parentheses after computed results and postfix operators multiply.
				frames.push({
					close: char === '(' ? ')' : char === '[' ? ']' : '}',
					delimiter: char !== '(' || callable,
					callableAfter: char === '[' && (endsValue || previous?.text === '?.'),
				});
				endsValue = false;
				callable = false;
			} else if (char === ')' || char === ']' || char === '}') {
				const frame = frames[frames.length - 1]?.close === char ? frames.pop() : undefined;
				endsValue = true;
				callable = frame?.callableAfter ?? false;
			} else {
				if (char !== "'" && char !== '!') endsValue = false;
				callable = text === '?.';
			}
		} else {
			const property = previous?.text === '.' || previous?.text === '?.';
			endsValue = !(kind === 'identifier' && !property && /^(and|or|xor|not|mod|to|in)$/.test(text));
			callable = kind === 'reference' || kind === 'directive' || kind === 'insertion'
				|| (kind === 'identifier' && endsValue && (property || !/^(true|false|null|undefined|NaN|Infinity)$/.test(text)));
		}
		previous = token;
	}
	return tokens;
}
