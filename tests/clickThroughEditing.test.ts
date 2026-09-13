import { MarkdownView, type Editor, type MarkdownPostProcessorContext, type WorkspaceLeaf } from 'obsidian';
import { registeredSnapshotFixture as fixture } from './sourceRegistryTestSupport';
import { flushSnapshots as flush } from './hostSnapshotTestSupport';
import { installHostDom } from './hostTestSupport';
import { BlockSurface } from '../src/host/blockSurface';
import { NumeralsRenderStyle } from '../src/numerals.types';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
beforeAll(installHostDom);

function surface(source = 'intro\r\n> ~~~~math\r\n> 2 + 3 =>\r\n> ~~~~') {
 const host = fixture(source);
 Object.assign(host.editor, {setCursor: jest.fn(), focus: jest.fn()});
 const element = host.view.containerEl.createDiv();
 const context = {sourcePath: host.file.path, getSectionInfo: () => ({text: source, lineStart: 1, lineEnd: 3})} as unknown as MarkdownPostProcessorContext;
 const controller = new BlockSurface(element, context, '2 + 3 =>', NumeralsRenderStyle.Plain, host.registry, host.app, jest.fn());
 controller.refresh();
 const destroy = () => {controller.dispose(); host.destroy();};
 return {...host, element, context, controller, destroy};
}

it('navigates through physical CRLF/container mapping without fence arithmetic', async () => {
 const host = surface(); await flush();
 host.element.querySelector('.numerals-result')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 expect(host.editor.setCursor).toHaveBeenCalledWith({line: 2, ch: 2});
 expect(host.editor.focus).toHaveBeenCalledTimes(1); host.destroy();
});

it('never focuses another pane just because its file path matches', async () => {
 const host = surface();
 const otherEditor = {getValue: host.text, offsetToPos: host.editor.offsetToPos, transaction: jest.fn(), setCursor: jest.fn(), focus: jest.fn()} as unknown as Editor;
 const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), {editor: otherEditor, file: host.file});
 document.body.append(view.containerEl); host.leaves.unshift({view} as unknown as WorkspaceLeaf); host.registry.reconcile(); await flush();
 host.element.querySelector('.numerals-input')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 expect(host.editor.focus).toHaveBeenCalledTimes(1); expect(otherEditor.focus).not.toHaveBeenCalled();
 view.containerEl.remove(); host.destroy();
});

it('discards navigation when the source, attachment or current snapshot changed', async () => {
 const host = surface(); await flush();
 const click = () => host.element.querySelector('.numerals-input')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 host.setText(host.text() + '\nnew bytes'); click(); expect(host.editor.setCursor).not.toHaveBeenCalled();
 host.setText(host.text().replace('\nnew bytes', '')); host.view.containerEl.remove(); click();
 expect(host.editor.setCursor).not.toHaveBeenCalled(); host.destroy();
});

it('keeps a same-file embed read-only and offers explicit target navigation', async () => {
 const host = surface(); host.controller.dispose();
 Object.assign(host.app.workspace, {openLinkText: jest.fn().mockResolvedValue(undefined)});
 const embed = host.view.containerEl.createDiv({cls: 'markdown-embed'}), element = embed.createDiv();
 const controller = new BlockSurface(element, host.context, '2 + 3 =>', NumeralsRenderStyle.Plain, host.registry, host.app, jest.fn());
 controller.refresh(); await flush();
 element.querySelector('.numerals-input')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 expect(host.editor.setCursor).not.toHaveBeenCalled();
 element.querySelector('button')!.click(); expect(host.app.workspace.openLinkText).toHaveBeenCalledWith(host.file.path, host.file.path);
 controller.dispose(); host.destroy();
});

it('does not navigate from ambiguous section evidence or after occurrence disposal', async () => {
 const host = surface(); host.context.getSectionInfo = () => null; host.controller.refresh(); await flush();
 host.element.dispatchEvent(new MouseEvent('click', {bubbles: true})); expect(host.editor.setCursor).not.toHaveBeenCalled();
 host.controller.dispose(); host.element.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 expect(host.editor.setCursor).not.toHaveBeenCalled(); host.destroy();
});

it('accepts native Text and SVG click targets using the rendered owner document', async () => {
 const host = surface(); await flush();
 host.element.querySelector('.numerals-input')!.firstChild!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); host.element.querySelector('.numerals-result')!.appendChild(svg);
 svg.dispatchEvent(new MouseEvent('click', {bubbles: true}));
 expect(host.editor.setCursor).toHaveBeenCalledTimes(2); expect(host.editor.setCursor).toHaveBeenLastCalledWith({line: 2, ch: 2}); host.destroy();
});

it('navigates mapped Text targets from an iframe-owned render document without global constructor assumptions', async () => {
 const iframe = document.body.appendChild(document.createElement('iframe')), doc = iframe.contentDocument!, win = doc.defaultView!;
 const prototype = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div'))) as object;
 for (const name of ['createEl', 'createDiv', 'createSpan', 'empty', 'addClass', 'toggleClass', 'setText']) {
  Object.defineProperty(prototype, name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)!);
 }
 const host = fixture('```math\n2 + 3\n```'); Object.assign(host.editor, {setCursor: jest.fn(), focus: jest.fn()});
 host.view.containerEl.remove(); const container = doc.body.appendChild(doc.createElement('div'));
 Object.assign(host.view, {containerEl: container}); host.registry.reconcile();
 const element = container.createDiv(), ctx = {sourcePath: host.file.path,
  getSectionInfo: () => ({text: host.text(), lineStart: 0, lineEnd: 2})} as unknown as MarkdownPostProcessorContext;
 const block = new BlockSurface(element, ctx, '2 + 3', NumeralsRenderStyle.Plain, host.registry, host.app, jest.fn());
 block.refresh(); await flush();
 element.querySelector('.numerals-input')!.firstChild!.dispatchEvent(new win.MouseEvent('click', {bubbles: true}));
 expect(host.editor.setCursor).toHaveBeenCalledWith({line: 1, ch: 0}); block.dispose(); host.destroy(); iframe.remove();
});
