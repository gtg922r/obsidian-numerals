import * as math from 'mathjs';
import { readFileSync, writeFileSync } from 'fs';

type MathJsDoc = {
	category?: string;
};

const mathWithDocs = math as typeof math & { docs: Record<string, MathJsDoc> };
const MATHJS_UTILITIES_PATH = 'src/mathjsUtilities.ts';
const SYMBOL_ARRAY_PATTERN = /const MATHJS_BUILT_IN_SYMBOLS: readonly string\[\] = \[\n[\s\S]*?\n\] as const;/;

export const EXCLUDED_DOC_SYMBOLS = [
	'E',
	'PI',
	'bigint',
	'bignumber',
	'boolean',
	'complex',
	'config',
	'createUnit',
	'false',
	'fraction',
	'import',
	'index',
	'mapSlices',
	'matrix',
	'number',
	'parse',
	'sparse',
	'splitUnit',
	'string',
	'true',
	'typed',
	'unit',
	'version',
] as const;

export const LEGACY_UNDOCUMENTED_SYMBOLS = [
	'f|apply()',
	'p|atm',
] as const;

const EXCLUDED_DOC_SYMBOL_SET = new Set<string>(EXCLUDED_DOC_SYMBOLS);

export function formatMathJsDocSymbol(name: string, doc: MathJsDoc): string {
	if (doc.category === 'Constants') {
		return `c|${name}`;
	}

	if (doc.category === undefined) {
		return `p|${name}`;
	}

	return `f|${name}()`;
}

export function getExpectedMathJsSymbols(): string[] {
	return Object.entries(mathWithDocs.docs)
		.filter(([name]) => !EXCLUDED_DOC_SYMBOL_SET.has(name))
		.map(([name, doc]) => formatMathJsDocSymbol(name, doc))
		.concat(LEGACY_UNDOCUMENTED_SYMBOLS)
		.sort((a, b) => a.slice(2).localeCompare(b.slice(2)));
}

export function formatMathJsSymbolArray(symbols: readonly string[]): string {
	const lines: string[] = [];
	for (let i = 0; i < symbols.length; i += 5) {
		const lineSymbols = symbols
			.slice(i, i + 5)
			.map((symbol) => `'${symbol}'`)
			.join(', ');
		lines.push(`\t${lineSymbols},`);
	}

	return [
		'const MATHJS_BUILT_IN_SYMBOLS: readonly string[] = [',
		...lines,
		'] as const;',
	].join('\n');
}

function readCurrentSymbolArray(): string {
	const source = readFileSync(MATHJS_UTILITIES_PATH, 'utf8');
	const match = source.match(SYMBOL_ARRAY_PATTERN);

	if (!match) {
		throw new Error(`Could not find MATHJS_BUILT_IN_SYMBOLS array in ${MATHJS_UTILITIES_PATH}`);
	}

	return match[0];
}

function checkMathJsSymbols(): void {
	const expectedSymbolArray = formatMathJsSymbolArray(getExpectedMathJsSymbols());

	if (readCurrentSymbolArray() !== expectedSymbolArray) {
		throw new Error('Mathjs autocomplete symbols are out of sync. Run `npm run symbols:update`.');
	}
}

function updateMathJsSymbols(): void {
	const source = readFileSync(MATHJS_UTILITIES_PATH, 'utf8');
	const currentSymbolArray = readCurrentSymbolArray();
	const nextSymbolArray = formatMathJsSymbolArray(getExpectedMathJsSymbols());
	writeFileSync(MATHJS_UTILITIES_PATH, source.replace(currentSymbolArray, nextSymbolArray));
}

function runCli(): void {
	const command = process.argv[2] ?? 'check';

	if (command === 'check') {
		checkMathJsSymbols();
		return;
	}

	if (command === 'update') {
		updateMathJsSymbols();
		return;
	}

	throw new Error(`Unknown mathjs symbol command "${command}". Use "check" or "update".`);
}

if (process.env.NUMERALS_RUN_TS_SCRIPT === '1') {
	runCli();
}
