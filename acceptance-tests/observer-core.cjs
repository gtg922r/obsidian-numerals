'use strict';
const {LIMITS, check} = require('./contracts.cjs');

/** Bounded, synchronous, fail-visible telemetry; observers never throw into the product. */
class Journal {
  constructor(now = () => performance.now()) {
    this.now = now; this.started = now(); this.records = []; this.sequence = 0; this.bytes = 0;
    this.context = {caseId: null, actionId: null, phase: 'startup'}; this.faults = new Set(); this.closed = false;
  }
  fault(code) { this.faults.add(code); }
  emit(kind, data = {}) {
    if (this.closed) return;
    try {
      if (this.now() - this.started > LIMITS.deadlineMs) { this.fault('observer-deadline'); return; }
      const record = {sequence: ++this.sequence, at: this.now(), ...this.context, kind, ...data};
      const bytes = JSON.stringify(record).length * 2;
      if (this.sequence > LIMITS.events || this.bytes + bytes > LIMITS.bytes) { this.fault('observer-overflow'); return; }
      this.bytes += bytes; this.records.push(record);
    } catch { this.fault('observation-failed'); }
  }
  drain() { return {records: this.records.splice(0), faults: [...this.faults], sequence: this.sequence}; }
}
class Identities {
  constructor() { this.ids = new WeakMap(); this.serial = 0; }
  id(value, prefix) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
    if (!this.ids.has(value)) this.ids.set(value, `${prefix}-${++this.serial}`);
    return this.ids.get(value);
  }
}
class Ownership {
  constructor(journal, ids = new Identities()) { this.journal = journal; this.ids = ids; this.windows = new Map(); this.editors = new Map(); this.closed = false; this.transactions = new Map(); }
  addWindow(win, proof) {
    check(!this.closed && !win.closed && proof && proof.document === win.document, 'window-proof');
    if (!this.windows.has(win)) check(this.windows.size < LIMITS.windows, 'window-limit');
    const owner = {id: this.ids.id(win, 'window'), ...proof}; this.windows.set(win, owner); return owner;
  }
  addEditor(editor, owner) {
    check(!this.closed && this.windows.has(owner.window) && owner.view.editor === editor && owner.view.file === owner.file &&
      owner.view.containerEl.isConnected && owner.view.containerEl.ownerDocument === owner.window.document, 'editor-proof');
    if (!this.editors.has(editor)) check(this.editors.size < LIMITS.editors, 'editor-limit');
    const record = {...owner, id: this.ids.id(editor, 'editor'), windowId: this.windows.get(owner.window).id};
    this.editors.set(editor, record); return record;
  }
  current(editor) {
    const o = this.editors.get(editor);
    if (!o || this.closed || !this.windows.has(o.window) || o.window.closed || o.view.editor !== editor || o.view.file !== o.file || !o.view.containerEl.isConnected || o.view.containerEl.ownerDocument !== o.window.document) return;
    return o;
  }
  removeWindow(win) { for (const [editor, o] of this.editors) if (o.window === win) this.editors.delete(editor); this.windows.delete(win); }
  dispose() { this.closed = true; this.editors.clear(); this.windows.clear(); this.transactions.clear(); }
}
/** Descriptors only; bounded serialization never invokes user accessors/toJSON. */
function data(value, depth = 0, seen = new Set()) {
  if (value === undefined) return {type: 'undefined'};
  if (typeof value === 'bigint') return {type: 'bigint', text: String(value)};
  if (typeof value === 'number' && !Number.isFinite(value)) return {type: 'number', text: String(value)};
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') { check(value.length <= LIMITS.text, 'value-limit'); return value; }
  check(typeof value === 'object' && depth < 16 && !seen.has(value), 'value-shape');
  seen = new Set(seen).add(value);
  const entries = Object.getOwnPropertyDescriptors(value); check(Object.keys(entries).length <= 4096, 'value-count');
  const result = Array.isArray(value) ? [] : Object.create(null);
  for (const [key, descriptor] of Object.entries(entries)) {
    if (key === 'length' && Array.isArray(value)) continue;
    check('value' in descriptor, 'value-accessor');
    Object.defineProperty(result, key, {value: data(descriptor.value, depth + 1, seen), enumerable: true, writable: true, configurable: true});
  }
  return result;
}
class PopoutTicket {
  constructor(now = () => performance.now()) { this.now = now; this.deadline = now() + 10000; this.candidates = new Map(); this.leaf = undefined; this.cancelled = false; }
  setLeaf(leaf) { check(!this.leaf && !this.cancelled, 'popout-leaf'); this.leaf = leaf; }
  observe(workspaceWindow, win) { check(!this.cancelled && this.now() < this.deadline && workspaceWindow.win === win && this.candidates.size === 0, 'popout-event'); this.candidates.set(win, workspaceWindow); }
  proof(app) {
    check(!this.cancelled && this.now() < this.deadline, 'popout-deadline');
    const win = this.leaf?.view.containerEl.ownerDocument.defaultView;
    const workspaceWindow = this.candidates.get(win);
    return workspaceWindow && win.app === app && !win.closed ? {win, workspaceWindow, leaf: this.leaf} : undefined;
  }
  cancel() { this.cancelled = true; this.candidates.clear(); }
}
module.exports = {Journal, Identities, Ownership, PopoutTicket, data};
