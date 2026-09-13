import { MarkdownView, TFile, type App, type MarkdownPostProcessorContext, type WorkspaceLeaf } from 'obsidian';
import { SourceRegistry } from '../src/host/sourceRegistry';
import { snapshotFixture } from './hostSnapshotTestSupport';
export function registeredSnapshotFixture(text = '```math\n2\n```') {
 const host = snapshotFixture(text); host.coordinator.detach(host.editor);
 const file = Object.assign(new TFile(), {path: 'source.md'}); host.setFile(file);
 Object.assign(host.editor, {getValue: host.text});
 const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), {editor: host.editor, file}); document.body.append(view.containerEl);
 const leaves = [{view}] as unknown as WorkspaceLeaf[];
 const files = new Map([[file.path, file]]);
 const read = jest.fn(async () => text);
 const app = {workspace: {iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => leaves.forEach(callback)},
  vault: {getAbstractFileByPath: (path: string) => files.get(path), read}} as unknown as App;
 const registry = new SourceRegistry(app, host.coordinator); registry.reconcile();
 const context = {sourcePath: file.path} as MarkdownPostProcessorContext;
 const destroy = () => { registry.dispose(); host.coordinator.dispose(); view.containerEl.remove(); };
 return {...host, app, registry, file, view, leaves, files, read, context, destroy};
}
