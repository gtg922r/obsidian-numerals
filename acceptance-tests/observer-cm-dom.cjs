'use strict';
const {LIMITS} = require('./contracts.cjs');
/** Dependency injection keeps pure observer tests independent of an installed host. */
function cmObserver({ViewPlugin, editorInfoField, editorLivePreviewField, Transaction}, host) {
  const Observer = class {
    constructor(view) { this.view = view; this.witness = undefined; host.reconcile(); this.emitState(); }
    emitState() {
      const info = this.view.state.field(editorInfoField, false), owner = info?.editor && host.ownership.current(info.editor);
      if (!owner || owner.file !== info.file || !owner.view.containerEl.contains(this.view.dom) || this.view.dom.closest('.markdown-embed, .internal-embed')) return;
      if (info.editor.getValue() !== this.view.state.doc.toString()) return;
      return {editorId: owner.id, windowId: owner.windowId, sourcePath: owner.file.path, viewId: host.ids.id(this.view, 'cm'),
        mode: this.view.state.field(editorLivePreviewField, false) === true ? 'live-preview' : 'source'};
    }
    observe(event) {
      const owner = this.emitState(); this.witness = undefined; if (!owner) return;
      const value = event.type === 'input' ? event.data : event.clipboardData?.getData('text/plain');
      const record = {...owner, eventId: host.ids.id(event, 'event'), startStateId: host.ids.id(this.view.state, 'state'),
        selection: {from: this.view.state.selection.main.from, to: this.view.state.selection.main.to, ranges: this.view.state.selection.ranges.length},
        type: event.type, inputType: event.inputType ?? null, trusted: event.isTrusted === true,
        prevented: event.defaultPrevented, composing: Boolean(event.isComposing || this.view.composing),
        data: typeof value === 'string' && value.length <= 1024 ? value : null};
      this.witness = {event, state: this.view.state, record}; host.journal.emit('native-input', record);
      const witness = this.witness; queueMicrotask(() => { if (this.witness === witness) this.witness = undefined; });
    }
    update(update) {
      const witness = this.witness; this.witness = undefined;
      const owner = this.emitState(); if (!owner) return;
      for (const transaction of update.transactions) {
        const before = transaction.startState.doc.toString(), after = transaction.newDoc.toString();
        if (before.length > LIMITS.text || after.length > LIMITS.text) { host.journal.fault('cm-text-limit'); return; }
        const changes = []; transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({from, to, text: inserted.toString()}));
        const info = this.view.state.field(editorInfoField, false);
        const active = host.ownership.transactions.get(info?.editor)?.at(-1);
        host.journal.emit('cm-transaction', {...owner, wrapperSessionId: active?.wrapperSessionId ?? null, transactionId: active?.transactionId ?? null, before, after, changes, docChanged: transaction.docChanged,
          startStateId: host.ids.id(transaction.startState, 'state'), stateId: host.ids.id(transaction.state, 'state'),
          witnessEventId: witness && witness.state === transaction.startState ? witness.record.eventId : null,
          witnessPrevented: witness?.event.defaultPrevented ?? null,
          userEvent: transaction.annotation(Transaction.userEvent) ?? null, remote: transaction.annotation(Transaction.remote) === true,
          history: transaction.isUserEvent('undo') ? 'undo' : transaction.isUserEvent('redo') ? 'redo' : null});
      }
    }
    destroy() { this.witness = undefined; host.journal.emit('cm-destroy', {viewId: host.ids.id(this.view, 'cm')}); }
  };
  for (const method of ['emitState', 'observe', 'update', 'destroy']) {
    const original = Observer.prototype[method];
    Observer.prototype[method] = function (...args) {
      try { return Reflect.apply(original, this, args); } catch { host.journal.fault('cm-observation-gap'); }
    };
  }
  return ViewPlugin.fromClass(Observer, {eventObservers: {input(event) { this.observe(event); }, paste(event) { this.observe(event); }}});
}
function domRecord(el, context, host, phase) {
  if (!host.allowedNotes.has(context.sourcePath)) return;
  const owner = [...host.ownership.editors.values()].find(o => o.view.containerEl.contains(el));
  const section = context.getSectionInfo(el);
  const footnotes = Array.from(el.querySelectorAll('[data-footnote-id], a.footnote-link')).slice(0, 300).map(node => ({
    tag: node.tagName, id: node.getAttribute('id'), dataId: node.getAttribute('data-footnote-id'), line: node.getAttribute('data-line'),
    footref: node.getAttribute('data-footref'), href: node.getAttribute('href'), text: node.textContent?.slice(0, 256)}));
  return {phase, sourcePath: context.sourcePath, elementId: host.ids.id(el, 'element'), contextId: host.ids.id(context, 'context'),
    windowId: host.ownership.windows.get(el.ownerDocument.defaultView)?.id ?? null, editorId: owner?.id ?? null,
    connected: el.isConnected, origin: el.closest('.cm-editor') ? 'codemirror' : el.closest('.markdown-preview-view') ? 'reading' : 'unknown',
    section: section && section.text.length <= LIMITS.text ? {text: section.text, lineStart: section.lineStart, lineEnd: section.lineEnd} : null,
    text: el.textContent?.slice(0, LIMITS.text), footnotes};
}
module.exports = {cmObserver, domRecord};
