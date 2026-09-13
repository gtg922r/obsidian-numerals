import { EditorState, Transaction } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { TrustedInputRoot } from '../src/host/trustedInput';

function inputFixture() {
	const contentDOM = document.createElement('div'), target = contentDOM.appendChild(document.createElement('span'));
	const state = EditorState.create({doc: 'ab', selection: {anchor: 1}});
	const view = {state, contentDOM, composing: false} as unknown as EditorView;
	const root = new TrustedInputRoot();
	const event = {type: 'input', isTrusted: true, defaultPrevented: false, target, inputType: 'insertText', data: 'X', isComposing: false};
	const transaction = state.update({changes: {from: 1, insert: 'X'}, userEvent: 'input.type'});
	const update = {view, startState: state, transactions: [transaction]} as unknown as ViewUpdate;
	return {root, event, view, state, transaction, update};
}

it('consumes one trusted exact DOM/state/document correlation once', () => {
	const host = inputFixture(); host.root.observe(host.event as unknown as Event, host.view);
	expect(host.root.consume(host.update)).toBe(true);
	expect(host.root.consume(host.update)).toBe(false);
});

it('a CM input annotation without a trusted DOM event never establishes a root', () => {
	const host = inputFixture(); expect(host.root.consume(host.update)).toBe(false);
});

it.each(['undo', 'redo', 'input.type.compose', 'input.complete'])('does not rearm on %s', userEvent => {
	const host = inputFixture(); host.root.observe(host.event as unknown as Event, host.view);
	const transaction = host.state.update({changes: {from: 1, insert: 'X'}, userEvent});
	expect(host.root.consume({...host.update, transactions: [transaction]} as unknown as ViewUpdate)).toBe(false);
});

it('denies synchronized/programmatic changes even when their replacement matches', () => {
	const host = inputFixture(); host.root.observe(host.event as unknown as Event, host.view);
	const transaction = host.state.update({changes: {from: 1, insert: 'X'}, annotations: [Transaction.remote.of(true), Transaction.userEvent.of('input.type')]});
	expect(host.root.consume({...host.update, transactions: [transaction]} as unknown as ViewUpdate)).toBe(false);
});

it('any intervening selection update consumes the witness', () => {
	const host = inputFixture(); host.root.observe(host.event as unknown as Event, host.view);
	expect(host.root.consume({...host.update, transactions: [host.state.update({selection: {anchor: 0}})]} as unknown as ViewUpdate)).toBe(false);
	expect(host.root.consume(host.update)).toBe(false);
});

it.each([{isTrusted: false}, {isComposing: true}, {defaultPrevented: true}, {inputType: 'deleteContentBackward'}, {inputType: 'insertFromDrop'}])(
	'rejects ambiguous or unsupported native input %j', replacement => {
		const host = inputFixture(); host.root.observe({...host.event, ...replacement} as unknown as Event, host.view);
		expect(host.root.consume(host.update)).toBe(false);
	});

it('rejects another view, changed selection source, and an unexpected document', () => {
	const host = inputFixture();
	for (const update of [
		{...host.update, view: {...host.view}}, {...host.update, startState: EditorState.create({doc: 'ab'})},
		{...host.update, transactions: [host.state.update({changes: {from: 1, insert: 'Y'}, userEvent: 'input.type'})]},
	]) {
		host.root.observe(host.event as unknown as Event, host.view);
		expect(host.root.consume(update as ViewUpdate)).toBe(false);
	}
});

it('clears pending intent on lifecycle disposal and accepts an exact trusted paste', () => {
	const host = inputFixture(); host.root.observe(host.event as unknown as Event, host.view); host.root.clear();
	expect(host.root.consume(host.update)).toBe(false);
	host.root.observe({...host.event, type: 'paste', clipboardData: {getData: () => 'X'}} as unknown as Event, host.view);
	const transaction = host.state.update({changes: {from: 1, insert: 'X'}, userEvent: 'input.paste'});
	expect(host.root.consume({...host.update, transactions: [transaction]} as unknown as ViewUpdate)).toBe(true);
});


it('retires unused native intent before a later matching programmatic transaction', async () => {
 const host = inputFixture(); host.root.observe(host.event as unknown as Event, host.view);
 await Promise.resolve();
 expect(host.root.consume(host.update)).toBe(false);
});

it('normalizes trusted CRLF paste with the actual EditorState text policy', () => {
 const host = inputFixture();
 host.root.observe({...host.event, type: 'paste', clipboardData: {getData: () => 'X\r\nY'}} as unknown as Event, host.view);
 const transaction = host.state.update({changes: {from: 1, insert: host.state.toText('X\r\nY')}, userEvent: 'input.paste'});
 expect(host.root.consume({...host.update, transactions: [transaction]} as unknown as ViewUpdate)).toBe(true);
});
