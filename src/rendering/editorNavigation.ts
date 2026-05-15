import { App, Editor, MarkdownView, WorkspaceLeaf } from 'obsidian';

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
