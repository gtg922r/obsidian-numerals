import { Transaction, type EditorState } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';

interface InputWitness {
	readonly view: EditorView;
	readonly state: EditorState;
	readonly event: Event;
	readonly after: string;
}

/** Positive evidence is an exact one-use DOM-input/state/transaction correlation. */
export class TrustedInputRoot {
	private witness?: InputWitness;

	observe(event: Event, view: EditorView): void {
		this.witness = undefined;
		if (!event.isTrusted || event.defaultPrevented || view.composing || view.state.selection.ranges.length !== 1) return;
		const target = event.target;
		if (!target || !view.contentDOM.contains(target as Node)) return;
		let text: string | undefined;
		// A trusted input event follows the actual native DOM change. Composition,
		// deletion, completion and unknown asynchronous paths remain conservative.
		if (event.type === 'input') {
			const input = event as InputEvent;
			if (input.inputType === 'insertText' && !input.isComposing && typeof input.data === 'string') text = input.data;
		} else if (event.type === 'paste') {
			text = (event as ClipboardEvent).clipboardData?.getData('text/plain');
		}
		if (text === undefined) return;
		const state = view.state, {from, to} = state.selection.main;
		const witness = {view, state, event, after: state.doc.sliceString(0, from) + state.toText(text).toString() + state.doc.sliceString(to)};
		this.witness = witness;
		// CM can decline native input without publishing a ViewUpdate. Retire the
		// unused identity at the end of this DOM-input processing window; a later
		// matching programmatic transaction cannot inherit it. Delayed paths remain
		// conservative. Identity checking never expires a newer input's witness.
		queueMicrotask(() => { if (this.witness === witness) this.witness = undefined; });
	}

	consume(update: ViewUpdate): boolean {
		const witness = this.witness;
		this.witness = undefined;
		if (!witness || witness.view !== update.view || witness.state !== update.startState || witness.event.defaultPrevented) return false;
		// Every intervening update consumes the witness, including selection/effects.
		if (update.transactions.length !== 1) return false;
		const transaction = update.transactions[0];
		if (!transaction.docChanged || transaction.startState !== witness.state ||
			transaction.annotation(Transaction.remote) === true || transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) return false;
		const expectedEvent = witness.event.type === 'paste' ? 'input.paste' : 'input.type';
		return transaction.isUserEvent(expectedEvent) && !transaction.isUserEvent('input.type.compose') &&
			transaction.newDoc.toString() === witness.after;
	}

	clear(): void { this.witness = undefined; }
}
