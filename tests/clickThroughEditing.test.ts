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
