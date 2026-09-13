import { App, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import {
	findEditorForPath,
	getTextOffsetFromPoint,
	handleNumeralsBlockClick,
	sourceChForRenderedOffset,
} from '../src/rendering/editorNavigation';

type MockEditor = {
	getLine: jest.Mock;
	setCursor: jest.Mock;
	focus: jest.Mock;
};

function createMarkdownLeaf(path: string, editor: MockEditor) {
	return {
		view: Object.assign(Object.create(MarkdownView.prototype), {
			file: { path },
			editor,
		}),
	};
}

function createMockElement(tag: string = 'div'): HTMLElement {
	const el = document.createElement(tag);
	(el as any).createEl = function(
		this: HTMLElement,
		tagName: string,
		options?: { text?: string; cls?: string | string[] }
	) {
		const child = createMockElement(tagName);
		if (options?.text) child.textContent = options.text;
		if (options?.cls) {
			const classes = Array.isArray(options.cls) ? options.cls : [options.cls];
			classes.forEach((className) => child.classList.add(className));
		}
		this.appendChild(child);
		return child;
	};
	return el;
}

describe('click-through editor navigation', () => {
	it('should find the editor for the requested source path', () => {
		const wrongEditor: MockEditor = {
			getLine: jest.fn(),
			setCursor: jest.fn(),
			focus: jest.fn(),
		};
		const rightEditor: MockEditor = {
			getLine: jest.fn(),
			setCursor: jest.fn(),
			focus: jest.fn(),
		};
		const app = {
			workspace: {
				iterateAllLeaves: jest.fn((callback: (leaf: unknown) => void) => {
					callback(createMarkdownLeaf('other.md', wrongEditor));
					callback(createMarkdownLeaf('source.md', rightEditor));
				}),
			},
		} as unknown as App;

		expect(findEditorForPath(app, 'source.md')).toBe(rightEditor);
	});

	it('should return undefined when no matching editor is open', () => {
		const editor: MockEditor = {
			getLine: jest.fn(),
			setCursor: jest.fn(),
			focus: jest.fn(),
		};
		const app = {
			workspace: {
				iterateAllLeaves: jest.fn((callback: (leaf: unknown) => void) => {
					callback(createMarkdownLeaf('other.md', editor));
				}),
			},
		} as unknown as App;

		expect(findEditorForPath(app, 'source.md')).toBeUndefined();
	});

	it('should map rendered offsets to exact source positions when rendered text exists in source', () => {
		expect(sourceChForRenderedOffset('total = apples + oranges =>', 'total = apples + oranges ', 8)).toBe(8);
	});

	it('should clamp rendered offsets when source mapping is approximate', () => {
		expect(sourceChForRenderedOffset('@[profit::100] = sales - costs', 'profit = sales - costs', 100)).toBe(30);
	});

	it('should map cleaned insertion directive text back to editable source positions', () => {
		const sourceLine = '@[profit::100] = sales - costs';
		const renderedInputText = 'profit = sales - costs';

		expect(sourceChForRenderedOffset(sourceLine, renderedInputText, 0)).toBe(2);
		expect(sourceChForRenderedOffset(sourceLine, renderedInputText, 6)).toBe(8);
		expect(sourceChForRenderedOffset(sourceLine, renderedInputText, 9)).toBe(17);
	});

	it('should read a text offset from a DOM caret position', () => {
		const input = document.createElement('span');
		input.textContent = 'apples + oranges';
		document.body.appendChild(input);
		const textNode = input.firstChild as Text;
		Object.defineProperty(document, 'caretPositionFromPoint', {
			configurable: true,
			value: jest.fn(() => ({ offsetNode: textNode, offset: 6 })),
		});

		expect(getTextOffsetFromPoint(input, 10, 20)).toBe(6);

		Reflect.deleteProperty(document, 'caretPositionFromPoint');
		input.remove();
	});

	it('should focus the source editor at the clicked input character', () => {
		const editor: MockEditor = {
			getLine: jest.fn(() => 'apples + oranges'),
			setCursor: jest.fn(),
			focus: jest.fn(),
		};
		const app = {
			workspace: {
				iterateAllLeaves: jest.fn((callback: (leaf: unknown) => void) => {
					callback(createMarkdownLeaf('source.md', editor));
				}),
			},
		} as unknown as App;
		const ctx = {
			sourcePath: 'source.md',
			getSectionInfo: jest.fn(() => ({ lineStart: 10 })),
		} as unknown as MarkdownPostProcessorContext;
		const block = createMockElement('div');
		const line = block.createEl('div', { cls: 'numerals-line' });
		line.dataset.sourceLine = '2';
		const input = line.createEl('span', { cls: 'numerals-input', text: 'apples + oranges' });
		line.createEl('span', { cls: 'numerals-result', text: ' -> 15' });
		const textNode = input.firstChild as Text;
		Object.defineProperty(document, 'caretPositionFromPoint', {
			configurable: true,
			value: jest.fn(() => ({ offsetNode: textNode, offset: 6 })),
		});

		const event = new MouseEvent('click', { clientX: 10, clientY: 20, bubbles: true });
		Object.defineProperty(event, 'target', { value: input });

		handleNumeralsBlockClick(event, ctx, block, app);

		expect(editor.setCursor).toHaveBeenCalledWith({ line: 13, ch: 6 });
		expect(editor.focus).toHaveBeenCalled();

		Reflect.deleteProperty(document, 'caretPositionFromPoint');
	});

	it('should place the cursor at end of source line when clicking the result area', () => {
		const editor: MockEditor = {
			getLine: jest.fn(() => 'apples + oranges'),
			setCursor: jest.fn(),
			focus: jest.fn(),
		};
		const app = {
			workspace: {
				iterateAllLeaves: jest.fn((callback: (leaf: unknown) => void) => {
					callback(createMarkdownLeaf('source.md', editor));
				}),
			},
		} as unknown as App;
		const ctx = {
			sourcePath: 'source.md',
			getSectionInfo: jest.fn(() => ({ lineStart: 10 })),
		} as unknown as MarkdownPostProcessorContext;
		const block = createMockElement('div');
		const line = block.createEl('div', { cls: 'numerals-line' });
		line.dataset.sourceLine = '2';
		line.createEl('span', { cls: 'numerals-input', text: 'apples + oranges' });
		const result = line.createEl('span', { cls: 'numerals-result', text: ' -> 15' });

		const event = new MouseEvent('click', { clientX: 10, clientY: 20, bubbles: true });
		Object.defineProperty(event, 'target', { value: result });

		handleNumeralsBlockClick(event, ctx, block, app);

		expect(editor.setCursor).toHaveBeenCalledWith({ line: 13, ch: 16 });
		expect(editor.focus).toHaveBeenCalled();
	});

	it('should no-op when the clicked line has no source line index', () => {
		const editor: MockEditor = {
			getLine: jest.fn(() => 'apples + oranges'),
			setCursor: jest.fn(),
			focus: jest.fn(),
		};
		const app = {
			workspace: {
				iterateAllLeaves: jest.fn((callback: (leaf: unknown) => void) => {
					callback(createMarkdownLeaf('source.md', editor));
				}),
			},
		} as unknown as App;
		const ctx = {
			sourcePath: 'source.md',
			getSectionInfo: jest.fn(() => ({ lineStart: 10 })),
		} as unknown as MarkdownPostProcessorContext;
		const block = createMockElement('div');
		const line = block.createEl('div', { cls: 'numerals-line' });
		const input = line.createEl('span', { cls: 'numerals-input', text: 'apples + oranges' });
		const event = new MouseEvent('click', { clientX: 10, clientY: 20, bubbles: true });
		Object.defineProperty(event, 'target', { value: input });

		handleNumeralsBlockClick(event, ctx, block, app);

		expect(editor.setCursor).not.toHaveBeenCalled();
		expect(editor.focus).not.toHaveBeenCalled();
	});
});

describe('navigation across document realms', () => {
	it.each(['text', 'svg'])('handles a foreign-document %s target without editing note text', kind => {
		const iframe = document.createElement('iframe'); document.body.appendChild(iframe);
		const doc = iframe.contentDocument!, win = doc.defaultView!;
		const block = doc.createElement('div'), line = doc.createElement('div');
		line.className = 'numerals-line'; line.dataset.sourceLine = '2'; block.appendChild(line); doc.body.appendChild(block);
		const input = doc.createElement('span'); input.className = 'numerals-input'; input.textContent = '2 + 3'; line.appendChild(input);
		let target: Node = input.firstChild!;
		if (kind === 'svg') {
			const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
			target = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.appendChild(target); line.appendChild(svg);
		}
		const range = doc.createRange(); range.setStart(input.firstChild!, 2); range.collapse(true);
		Object.defineProperty(doc, 'caretRangeFromPoint', { value: jest.fn(() => range), configurable: true });
		const editor = { getLine: jest.fn(() => '2 + 3'), setCursor: jest.fn(), focus: jest.fn(), setLine: jest.fn(), transaction: jest.fn() };
		const app = { workspace: { iterateAllLeaves: (visit: (leaf: unknown) => void) => visit(createMarkdownLeaf('source.md', editor)) } } as unknown as App;
		const ctx = { sourcePath: 'source.md', getSectionInfo: () => ({ lineStart: 3 }) } as unknown as MarkdownPostProcessorContext;
		const event = new win.MouseEvent('click', { clientX: 10, clientY: 20 }); Object.defineProperty(event, 'target', { value: target });
		handleNumeralsBlockClick(event, ctx, block, app);
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 6, ch: kind === 'text' ? 2 : 5 });
		expect(editor.focus).toHaveBeenCalledTimes(1); expect(editor.setLine).not.toHaveBeenCalled(); expect(editor.transaction).not.toHaveBeenCalled();
		iframe.remove();
	});
});
