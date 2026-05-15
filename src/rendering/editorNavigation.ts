import { App, Editor, MarkdownPostProcessorContext, MarkdownView, WorkspaceLeaf } from 'obsidian';

type CaretPositionDocument = Document & {
	caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

type CaretRangeFromPoint = (x: number, y: number) => Range | null;

/**
 * Find the editor for a specific file path by searching all workspace leaves.
 * More reliable than getActiveViewOfType, which can return the wrong editor in split panes.
 */
export function findEditorForPath(app: App, sourcePath: string): Editor | undefined {
	let found: Editor | undefined;
	app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
		if (found) return;
		if (leaf.view instanceof MarkdownView && leaf.view.file?.path === sourcePath) {
			found = leaf.view.editor;
		}
	});
	return found;
}

function getCaretRangeFromPoint(doc: Document, clientX: number, clientY: number): Range | null {
	const caretDoc = doc as CaretPositionDocument;
	const position = caretDoc.caretPositionFromPoint?.(clientX, clientY);
	if (position) {
		const range = doc.createRange();
		range.setStart(position.offsetNode, position.offset);
		range.collapse(true);
		return range;
	}

	const legacyRangeFromPoint = (doc as unknown as Record<string, unknown>)['caretRangeFromPoint'];
	if (typeof legacyRangeFromPoint === 'function') {
		return (legacyRangeFromPoint as CaretRangeFromPoint).call(doc, clientX, clientY);
	}
	return null;
}

export function getTextOffsetFromPoint(element: HTMLElement, clientX: number, clientY: number): number | null {
	const range = getCaretRangeFromPoint(element.ownerDocument, clientX, clientY);
	if (!range || !element.contains(range.startContainer)) {
		return null;
	}

	const measure = element.ownerDocument.createRange();
	measure.selectNodeContents(element);
	measure.setEnd(range.startContainer, range.startOffset);
	const offset = measure.toString().length;
	measure.detach();
	return offset;
}

export function sourceChForRenderedOffset(
	sourceLine: string,
	renderedInputText: string,
	renderedOffset: number
): number {
	const nonNegativeRenderedOffset = Math.max(0, renderedOffset);
	const exactStart = renderedInputText.length > 0 ? sourceLine.indexOf(renderedInputText) : -1;
	if (exactStart >= 0) {
		const clampedRenderedOffset = Math.min(nonNegativeRenderedOffset, renderedInputText.length);
		return Math.min(exactStart + clampedRenderedOffset, sourceLine.length);
	}

	const alignedSourceCh = sourceChFromRenderedSubsequence(
		sourceLine,
		renderedInputText,
		nonNegativeRenderedOffset
	);
	if (alignedSourceCh !== null) {
		return alignedSourceCh;
	}

	return Math.min(nonNegativeRenderedOffset, sourceLine.length);
}

function sourceChFromRenderedSubsequence(
	sourceLine: string,
	renderedInputText: string,
	renderedOffset: number
): number | null {
	if (renderedInputText.length === 0) {
		return null;
	}

	const renderedChToSourceCh: Array<number | undefined> = [];
	let renderedIndex = 0;

	for (let sourceIndex = 0; sourceIndex < sourceLine.length; sourceIndex++) {
		if (sourceLine[sourceIndex] !== renderedInputText[renderedIndex]) {
			continue;
		}

		renderedChToSourceCh[renderedIndex] ??= sourceIndex;
		renderedIndex++;
		renderedChToSourceCh[renderedIndex] = sourceIndex + 1;

		if (renderedIndex === renderedInputText.length) {
			break;
		}
	}

	if (renderedIndex !== renderedInputText.length) {
		return null;
	}

	if (renderedOffset > renderedInputText.length) {
		return sourceLine.length;
	}

	return renderedChToSourceCh[renderedOffset] ?? null;
}

export function handleNumeralsBlockClick(
	event: MouseEvent,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	app: App
): void {
	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return;
	}

	const lineElement = target.closest<HTMLElement>('.numerals-line');
	if (!lineElement || !el.contains(lineElement)) {
		return;
	}

	const sourceLineIndex = Number.parseInt(lineElement.dataset.sourceLine ?? '', 10);
	if (!Number.isInteger(sourceLineIndex)) {
		return;
	}

	const sectionInfo = ctx.getSectionInfo(el);
	if (sectionInfo?.lineStart === undefined) {
		return;
	}

	const editor = findEditorForPath(app, ctx.sourcePath);
	if (!editor) {
		return;
	}

	const editorLine = sectionInfo.lineStart + 1 + sourceLineIndex;
	const sourceLine = editor.getLine(editorLine);
	let ch = sourceLine.length;

	const inputElement = target.closest<HTMLElement>('.numerals-input');
	if (inputElement && lineElement.contains(inputElement)) {
		const renderedOffset = getTextOffsetFromPoint(inputElement, event.clientX, event.clientY);
		if (renderedOffset !== null) {
			ch = sourceChForRenderedOffset(sourceLine, inputElement.textContent ?? '', renderedOffset);
		}
	}

	editor.setCursor({ line: editorLine, ch });
	editor.focus();
}
