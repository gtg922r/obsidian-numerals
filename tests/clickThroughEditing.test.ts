import { App, MarkdownView } from 'obsidian';
import { findEditorForPath } from '../src/rendering/editorNavigation';

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
});
