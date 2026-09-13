import { App, MarkdownPostProcessorContext } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/numerals.types';
import { originalSource } from '../src/processing/expressionScanner';
import { renderError, renderNumeralsBlock, processAndRenderNumeralsBlockFromSource } from '../src/numeralsUtilities';
import { EvaluationResult, ProcessedBlock, RenderContext, NumeralsRenderStyle, NumeralsNumberFormat, NumeralsSettings, numeralsBlockInfo } from '../src/numerals.types';
import { createNumberFormatProfile, createResultFormatter } from '../src/formatting';

// Mock Obsidian functions before importing renderers
jest.mock('obsidian', () => ({
	renderMath: jest.fn((tex: string) => {
		const span = document.createElement('span');
		span.textContent = `TeX:${tex}`;
		return span;
	}),
	finishRenderMath: jest.fn().mockResolvedValue(undefined),
	sanitizeHTMLToDom: jest.fn((html: string) => {
		const fragment = document.createDocumentFragment();
		const div = document.createElement('div');
		div.innerHTML = html;
		fragment.appendChild(div);
		return fragment;
	})
}));

// Helper to create mock HTMLElement with Obsidian methods
function createMockElement(tag: string = 'div'): HTMLElement {
	const el = document.createElement(tag);
	(el as any).createEl = function(this: HTMLElement, tag: string, options?: { text?: string; cls?: string | string[] }) {
		const child = createMockElement(tag);
		if (options?.text) child.textContent = options.text;
		if (options?.cls) {
			const classes = Array.isArray(options.cls) ? options.cls : [options.cls];
			classes.forEach(c => child.classList.add(c));
		}
		this.appendChild(child);
		return child;
	};
	(el as any).toggleClass = function(this: HTMLElement, className: string, add: boolean) {
		if (add) this.classList.add(className);
		else this.classList.remove(className);
	};
	(el as any).setText = function(this: HTMLElement, text: string) {
		this.textContent = text;
	};
	return el;
}

describe('renderError', () => {
	it('should render error message with correct structure', () => {
		const container = createMockElement('div');
		const evaluationResult: EvaluationResult = {
			results: [],
			inputs: ['1 + x'],
			errorMsg: new Error('Undefined symbol x'),
			errorInput: '1 + x'
		};
		(evaluationResult.errorMsg as Error).name = 'ReferenceError';

		renderError(container, evaluationResult);

		const errorLine = container.querySelector('.numerals-error-line');
		expect(errorLine).toBeTruthy();
		expect(errorLine?.querySelector('.numerals-input')?.textContent).toBe('1 + x');
		expect(errorLine?.querySelector('.numerals-error-name')?.textContent).toBe('ReferenceError:');
		expect(errorLine?.querySelector('.numerals-error-message')?.textContent).toBe('Undefined symbol x');
	});

	it('should apply correct CSS classes', () => {
		const container = createMockElement('div');
		const evaluationResult: EvaluationResult = {
			results: [],
			inputs: ['bad input'],
			errorMsg: new Error('Test error'),
			errorInput: 'bad input'
		};

		renderError(container, evaluationResult);

		const errorLine = container.querySelector('.numerals-error-line');
		expect(errorLine?.classList.contains('numerals-error-line')).toBe(true);
		expect(errorLine?.classList.contains('numerals-line')).toBe(true);
	});
});

describe('renderNumeralsBlock', () => {
	let container: HTMLElement;
	let processedBlock: ProcessedBlock;
	let settings: NumeralsSettings;
	let context: RenderContext;

	beforeEach(() => {
		container = createMockElement('div');

		const blockInfo: numeralsBlockInfo = {
			emitter_lines: [],
			insertion_lines: [],
			hidden_lines: [],
			shouldHideNonEmitterLines: false
		};

		processedBlock = {
			rawRows: ['1 + 1', '2 + 2', '3 + 3'],
			processedSource: '1 + 1\n2 + 2\n3 + 3',
			sourceMap: originalSource(''),
			transparentLineIndexes: [],
			blockInfo,
			formatOverrides: {},
			invalidFormatDirectives: [],
		};

		settings = {
			hideEmitterMarkupInInput: false,
			resultSeparator: ' = ',
		} as NumeralsSettings;

		context = {
			renderStyle: NumeralsRenderStyle.Plain,
			settings,
			formatter: createResultFormatter({
				profile: createNumberFormatProfile(NumeralsNumberFormat.System, 'en-US'),
			}),
			formatOverrides: {},
			preProcessors: []
		};
	});

	it('should render all lines with Plain renderer', () => {
		const evaluationResult: EvaluationResult = {
			results: [2, 4, 6],
			inputs: ['1 + 1', '2 + 2', '3 + 3'],
			errorMsg: null,
			errorInput: ''
		};

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll('.numerals-line');
		expect(lines.length).toBe(3);
	});

	it('should attach source line indices to rendered lines', () => {
		const evaluationResult: EvaluationResult = {
			results: [2, 4, 6],
			inputs: ['1 + 1', '2 + 2', '3 + 3'],
			errorMsg: null,
			errorInput: ''
		};

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll<HTMLElement>('.numerals-line');
		expect(lines[0].dataset.sourceLine).toBe('0');
		expect(lines[1].dataset.sourceLine).toBe('1');
		expect(lines[2].dataset.sourceLine).toBe('2');
	});

	it('should skip hidden lines', () => {
		processedBlock.blockInfo.hidden_lines = [1];
		const evaluationResult: EvaluationResult = {
			results: [2, 4, 6],
			inputs: ['1 + 1', '2 + 2', '3 + 3'],
			errorMsg: null,
			errorInput: ''
		};

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll('.numerals-line');
		expect(lines.length).toBe(2);
	});

	it('should keep source line indices when hidden lines are skipped', () => {
		processedBlock.blockInfo.hidden_lines = [1];
		const evaluationResult: EvaluationResult = {
			results: [2, 4, 6],
			inputs: ['1 + 1', '2 + 2', '3 + 3'],
			errorMsg: null,
			errorInput: ''
		};

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll<HTMLElement>('.numerals-line');
		expect(lines.length).toBe(2);
		expect(lines[0].dataset.sourceLine).toBe('0');
		expect(lines[1].dataset.sourceLine).toBe('2');
	});

	it('should add emitter class to emitter lines', () => {
		processedBlock.blockInfo.emitter_lines = [0, 2];
		const evaluationResult: EvaluationResult = {
			results: [2, 4, 6],
			inputs: ['1 + 1', '2 + 2', '3 + 3'],
			errorMsg: null,
			errorInput: ''
		};

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll('.numerals-line');
		expect(lines[0].classList.contains('numerals-emitter')).toBe(true);
		expect(lines[1].classList.contains('numerals-emitter')).toBe(false);
		expect(lines[2].classList.contains('numerals-emitter')).toBe(true);
	});

	it('should render error if present', () => {
		const evaluationResult: EvaluationResult = {
			results: [2, 4],
			inputs: ['1 + 1', '2 + 2', 'bad'],
			errorMsg: new Error('Parse error'),
			errorInput: 'bad'
		};
		(evaluationResult.errorMsg as Error).name = 'SyntaxError';

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const errorLine = container.querySelector('.numerals-error-line');
		expect(errorLine).toBeTruthy();
		expect(errorLine?.querySelector('.numerals-input')?.textContent).toBe('bad');
	});

	it('should hide non-emitter lines when shouldHideNonEmitterLines is true', () => {
		processedBlock.blockInfo.shouldHideNonEmitterLines = true;
		processedBlock.blockInfo.emitter_lines = [0, 2];
		const evaluationResult: EvaluationResult = {
			results: [2, 4, 6],
			inputs: ['1 + 1', '2 + 2', '3 + 3'],
			errorMsg: null,
			errorInput: ''
		};

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll('.numerals-line');
		expect(lines.length).toBe(2); // Only emitter lines should be rendered
	});

	it('should work with TeX renderer', () => {
		context.renderStyle = NumeralsRenderStyle.TeX;
		const evaluationResult: EvaluationResult = {
			results: [2],
			inputs: ['1 + 1'],
			errorMsg: null,
			errorInput: ''
		};
		processedBlock.rawRows = ['1 + 1'];

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll('.numerals-line');
		expect(lines.length).toBe(1);
	});

	it('should work with SyntaxHighlight renderer', () => {
		context.renderStyle = NumeralsRenderStyle.SyntaxHighlight;
		const evaluationResult: EvaluationResult = {
			results: [2],
			inputs: ['1 + 1'],
			errorMsg: null,
			errorInput: ''
		};
		processedBlock.rawRows = ['1 + 1'];

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll('.numerals-line');
		expect(lines.length).toBe(1);
	});

	it('should handle empty results (undefined)', () => {
		const evaluationResult: EvaluationResult = {
			results: [2, undefined, 6],
			inputs: ['1 + 1', '', '3 + 3'],
			errorMsg: null,
			errorInput: ''
		};
		processedBlock.rawRows = ['1 + 1', '', '3 + 3'];

		renderNumeralsBlock(container, evaluationResult, processedBlock, context);

		const lines = container.querySelectorAll('.numerals-line');
		expect(lines.length).toBe(3);
	});
});


describe('integrated reference rendering', () => {
	test.each([NumeralsRenderStyle.Plain, NumeralsRenderStyle.TeX, NumeralsRenderStyle.SyntaxHighlight])('retains original note names and typed results in %s', async style => {
		const container = createMockElement();
		const app = { metadataCache: {
			getFirstLinkpathDest: () => ({ path: 'Budget 💰.md' }),
			getFileCache: () => ({ frontmatter: { numerals: 'all', price: -2 } }),
		} } as unknown as App;
		const formatter = createResultFormatter({ profile: createNumberFormatProfile(NumeralsNumberFormat.Fixed) });
		const result = processAndRenderNumeralsBlockFromSource(
			container, '[[Budget 💰]].price ^ 2', { sourcePath: 'source.md' } as MarkdownPostProcessorContext,
			{ numerals: 'all', __numerals_ref_0: 99 }, style, DEFAULT_SETTINGS, formatter, [], app,
		);
		await Promise.resolve();
		expect(result.dependencies[0].status).toBe('resolved');
		expect(container.querySelector('.numerals-input')?.textContent).toContain('Budget 💰');
		expect(container.querySelector('.numerals-result')?.textContent).toContain('4');
		expect(container.textContent).not.toMatch(/__numerals_ref|NumeralsReferenceLabel/);
	});
});


test('syntax highlighting preserves magic-variable text inside reference labels', () => {
	const container = createMockElement();
	const source = '[[n]].__total + [[__total]].x';
	const app = { metadataCache: {
		getFirstLinkpathDest: () => ({ path: 'n.md' }),
		getFileCache: () => ({ frontmatter: { numerals: 'all', __total: 2, x: 3 } }),
	} } as unknown as App;
	const formatter = createResultFormatter({ profile: createNumberFormatProfile(NumeralsNumberFormat.Fixed) });
	processAndRenderNumeralsBlockFromSource(container, source, { sourcePath: 'source.md' } as MarkdownPostProcessorContext, {}, NumeralsRenderStyle.SyntaxHighlight, DEFAULT_SETTINGS, formatter, [], app);
	expect(container.querySelector('.numerals-input')?.textContent).toBe('[[n]].__total+[[__total]].x');
	expect(container.querySelector('.numerals-result')?.textContent).toContain('5');
});
