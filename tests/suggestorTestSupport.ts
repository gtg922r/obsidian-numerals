import { MarkdownView, TFile, type Editor, type EditorPosition, type EditorSuggestContext, type PluginManifest, type WorkspaceLeaf } from 'obsidian';
import NumeralsPlugin from '../src/main';
import { NumeralsSuggestor, type NumeralsSuggestion } from '../src/NumeralsSuggestor';
import { createTestHost } from './hostTestSupport';
import { sourceLineAt, sourceLineStarts } from '../src/evaluation/sourceIndex';
import { flushSnapshots } from './hostSnapshotTestSupport';

export async function suggestorFixture(initial: string, saved?: unknown) {
 const host = createTestHost(), leaves: WorkspaceLeaf[] = [], buffers = new Map<string, string>();
 Object.assign(host.app.vault, {read: jest.fn(async (file: TFile) => buffers.get(file.path) ?? '')});
 jest.mocked(host.app.workspace.iterateAllLeaves).mockImplementation(callback => leaves.forEach(callback));
 const addEditor = (source: string, path = 'source.md') => {
  let text = source, from = 0, to = 0;
  const file = host.files.get(path) as TFile | undefined ?? Object.assign(new TFile(), {path});
  host.files.set(path, file); buffers.set(path, text);
  const position = (offset: number) => {const starts = sourceLineStarts(text), line = sourceLineAt(starts, offset); return {line, ch: offset - starts[line]};};
  const offset = (pos: EditorPosition) => sourceLineStarts(text)[pos.line] + pos.ch;
  const changed = () => host.workspaceEvents.fire('editor-change', editor);
  const replaceRange = jest.fn((value: string, start: EditorPosition, end: EditorPosition = start) => {
   const a = offset(start), b = offset(end); text = text.slice(0, a) + value + text.slice(b); changed();
  });
  const editor = {getValue: () => text, getLine: (line: number) => text.split(/\r\n|\r|\n/)[line],
   posToOffset: offset, offsetToPos: position, replaceRange,
   getCursor: (side?: string) => position(side === 'from' ? from : to),
   setCursor: jest.fn((pos: EditorPosition) => {from = to = offset(pos);}),
   transaction: jest.fn(), focus: jest.fn(),
  } as unknown as Editor;
  const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), {editor, file}); document.body.append(view.containerEl);
  leaves.push({view} as unknown as WorkspaceLeaf);
  return {editor, view, file, replaceRange, text: () => text,
   cursor: (a: number, b = a) => {from = a; to = b;},
   setText: (next: string) => {text = next; changed();},
   retarget(path: string) {
    const next = Object.assign(new TFile(), {path}); host.files.set(path, next); view.file = next;
    host.workspaceEvents.fire('file-open', next); return next;
   },
  };
 };
 const first = addEditor(initial), plugin = new NumeralsPlugin(host.app, {} as PluginManifest);
 jest.mocked(plugin.loadData).mockResolvedValue(saved); await plugin.onload(); await flushSnapshots();
 const suggestor = jest.mocked(plugin.registerEditorSuggest).mock.calls[0][0] as NumeralsSuggestor;
 const trigger = (current = first, at = current.text().length) => {
  current.cursor(at);
  const info = suggestor.onTrigger(current.editor.offsetToPos(at), current.editor, current.view.file);
  const context: EditorSuggestContext | null = info && {...info, editor: current.editor, file: current.view.file!};
  suggestor.context = context; return context;
 };
 const suggestions = async (current = first, at = current.text().length): Promise<NumeralsSuggestion[]> => {
  const context = trigger(current, at); return context ? await suggestor.getSuggestions(context) : [];
 };
 const dispose = () => {plugin.unload(); for (const leaf of leaves) leaf.view.containerEl.remove();};
 return {...host, ...first, first, addEditor, leaves, buffers, plugin, suggestor, trigger, suggestions, dispose};
}
