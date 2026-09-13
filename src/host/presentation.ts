import type { MathJsInstance, MathNode, ConstantNode } from 'mathjs';
import { NumeralsRenderStyle, type LineRenderData, type NumeralsSettings } from '../numerals.types';
import type { CalculationDescription, NoteSnapshot, NoteDiagnostic } from '../evaluation/noteSnapshot';
import { parseCrossNoteReferences } from '../processing/crossNoteResolver';
import { parseFormatDirectiveLine } from '../processing/formatDirectives';
import { prepareLineData } from '../rendering/linePreparation';
import { expressionToTeX } from '../rendering/texRendering';
import { replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw } from '../rendering/displayUtils';

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
}

/** Parsing is presentation-only, through the engine retained by this exact snapshot. */
export function inputPresentation(processed: string, raw: string, style: NumeralsRenderStyle,
	engine: MathJsInstance): {inputTeX?: string; inputHTML?: string} {
	if (style === NumeralsRenderStyle.TeX) return {inputTeX: expressionToTeX(processed, raw, engine)};
	if (style !== NumeralsRenderStyle.SyntaxHighlight) return {};
	let source = processed;
	const labels = new Map<string, string>();
	for (const [index, ref] of parseCrossNoteReferences(source).slice().reverse().entries()) {
		let symbol = `NumeralsReferenceLabel${index}`;
		while (processed.includes(symbol)) symbol += 'X';
		labels.set(symbol, `<span class="math-symbol">${escapeHtml(ref.fullMatch)}</span>`);
		source = source.slice(0, ref.start) + symbol + source.slice(ref.end);
	}
	let html = engine.parse(source).toHTML({handler: (node: MathNode) => {
		if (engine.isSymbolNode(node) && labels.has(node.name)) return node.name;
		if (node.type === 'ConstantNode' && typeof (node as ConstantNode).value === 'number') {
			return `<span class="math-number">${engine.format((node as ConstantNode).value, {notation: 'fixed'})}</span>`;
		}
		return undefined;
	}});
	html = replaceSumMagicVariableInProcessedWithSumDirectiveFromRaw(html, raw);
	if (labels.size) html = html.replace(new RegExp(`\\b(?:${[...labels.keys()].join('|')})\\b`, 'g'), symbol => labels.get(symbol)!);
	return {inputHTML: html};
}

export function prepareBlockPresentation(snapshot: NoteSnapshot, calculation: CalculationDescription,
	settings: NumeralsSettings, style: NumeralsRenderStyle, engine: MathJsInstance): {lines: LineRenderData[]; diagnostics: {message: string; input?: string}[]} {
	const block = calculation.block;
	if (!block) return {lines: [], diagnostics: []};
	const inputs: string[] = [], results: Parameters<typeof prepareLineData>[3] = [];
	const diagnostics: Pick<NoteDiagnostic, 'message' | 'input'>[] = [];
	for (const [lineIndex, source] of block.rawRows.entries()) {
		if (!block.transparentLineIndexes.includes(lineIndex)) continue;
		const directive = parseFormatDirectiveLine(source, lineIndex);
		if (directive.status === 'invalid') diagnostics.push({message: directive.error.message, input: source});
	}
	for (const diagnostic of snapshot.diagnostics) {
		if (diagnostic.kind === 'presentation' && diagnostic.sourceSpans?.some(span =>
			span.start >= calculation.span.start && span.end <= calculation.span.end)) diagnostics.push(diagnostic);
	}
	for (const row of calculation.rows) {
		inputs[row.rowIndex] = row.processedInput;
		if (row.transparent || row.result === undefined) continue;
		const formatted = snapshot.format(calculation.calculationId, row.rowIndex);
		if ('diagnostic' in formatted) diagnostics.push(formatted.diagnostic);
		else results[row.rowIndex] = formatted.value;
	}
	const lines = calculation.rows.map(row => {
		const line = prepareLineData(row.rowIndex, [...block.rawRows], inputs, results, block.blockInfo, settings);
		if (!line.isEmpty && !line.isHidden) {
			try { Object.assign(line, inputPresentation(line.processedInput, line.rawInput + (line.comment ?? ''), style, engine)); }
			catch (error: unknown) { diagnostics.push({message: `Unable to render input: ${error instanceof Error ? error.message : String(error)}`, input: line.rawInput}); }
		}
		return line;
	});
	return {lines, diagnostics};
}

export const STORED_RESULT_GUIDANCE = 'Stored result differs from the current result. Use Update stored results to write it once.';

export function storedResultDiffers(snapshot: NoteSnapshot, calculation: CalculationDescription): boolean {
	return Boolean(calculation.block?.insertionDirectives.some(directive => {
		const row = calculation.rows.find(row => row.rowIndex === directive.rowIndex);
		if (!row || row.result === undefined) return false;
		const formatted = snapshot.format(calculation.calculationId, directive.rowIndex);
		return 'value' in formatted && directive.storedValue?.expectedText !== formatted.value.canonical;
	}));
}
