import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { TrustedInputRoot } from '../src/host/trustedInput';

// The event's trust bit is supplied at the browser boundary. The DOM listener,
// mutation observer, CM input handler and transaction/update ordering are real CM.
function fixture(rejectInput = false) {
 const root = new TrustedInputRoot(), accepted: boolean[] = [];
 const listeners: {el: EventTarget; type: string; listener: EventListenerOrEventListenerObject}[] = [];
 const original = HTMLElement.prototype.addEventListener;
 const spy = jest.spyOn(HTMLElement.prototype, 'addEventListener').mockImplementation(function(this: HTMLElement, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
  listeners.push({el: this, type, listener}); original.call(this, type, listener, options);
 });
 const extension = ViewPlugin.fromClass(class {
  update(update: import('@codemirror/view').ViewUpdate) {accepted.push(root.consume(update));}
 }, {eventObservers: {input(event, view) {root.observe(event, view);}, paste(event, view) {root.observe(event, view);}}});
 const parent = document.body.appendChild(document.createElement('div'));
 const view = new EditorView({parent, state: EditorState.create({doc: 'ab', selection: {anchor: 1}, extensions: [extension, ...(rejectInput ? [EditorView.inputHandler.of(() => true)] : [])]})});
 spy.mockRestore();
 const emit = (type: 'input' | 'paste', text: string) => {
  const event = {type, bubbles: true, target: view.contentDOM, isTrusted: true, defaultPrevented: false,
   preventDefault() {this.defaultPrevented = true;}, inputType: 'insertText', data: text, isComposing: false,
   clipboardData: {getData: () => text}};
  for (const item of listeners.filter(item => item.el === view.contentDOM && item.type === type)) {
   const listener = item.listener;
   if (typeof listener === 'function') listener.call(view.contentDOM, event as unknown as Event);
   else listener.handleEvent(event as unknown as Event);
  }
  return event;
 };
 return {root, view, accepted, emit, destroy() {view.destroy(); parent.remove();}};
}

it('actual native-input CM ordering accepts plain typing', async () => {
 const host = fixture();
 try {
  host.view.contentDOM.querySelector('.cm-line')!.firstChild!.nodeValue = 'aXb';
  host.emit('input','X');
  await Promise.resolve();
  expect(host.view.state.doc.toString()).toBe('aXb');
  expect(host.accepted).toContain(true);
 } finally {host.destroy();}
});

it('actual synchronous paste ordering accepts plain paste before preventDefault', () => {
 const host = fixture();
 try {
  const event = host.emit('paste','X');
  expect(host.view.state.doc.toString()).toBe('aXb');
  expect(event.defaultPrevented).toBe(true);
  expect(host.accepted).toContain(true);
 } finally {host.destroy();}
});

it('must retire an unused native-input witness before a later labeled programmatic edit', async () => {
 const host = fixture(true);
 try {
  host.view.contentDOM.querySelector('.cm-line')!.firstChild!.nodeValue = 'aXb';
  host.emit('input','X');
  await Promise.resolve();
  expect(host.view.state.doc.toString()).toBe('ab'); // public inputHandler declined the edit
  expect(host.view.contentDOM.textContent).toBe('ab'); // CM repaired the native DOM
  expect(host.accepted).not.toContain(true);
  host.view.dispatch({changes: {from: 1, insert: 'X'}, userEvent: 'input.type'});
  expect(host.accepted.at(-1)).toBe(false); // Must not inherit the declined DOM input witness
 } finally {host.destroy();}
});

it('accepts deterministic CRLF paste using CM normalization', () => {
 const host = fixture();
 try {
  host.emit('paste','X\r\nY');
  expect(host.view.state.doc.toString()).toBe('aX\nYb');
  expect(host.accepted).toContain(true);
 } finally {host.destroy();}
});
