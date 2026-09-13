'use strict';
const {Plugin, MarkdownView, editorInfoField, editorLivePreviewField} = require('obsidian');
const {ViewPlugin} = require('@codemirror/view');
const {Transaction} = require('@codemirror/state');
const fs = require('node:fs');
const path = require('node:path');
const C = require('./contracts.cjs');
const {Journal, Identities, Ownership, PopoutTicket} = require('./observer-core.cjs');
const {observeEditor, observeVault} = require('./observer-writes.cjs');
const {StateObserver} = require('./observer-state.cjs');
const {cmObserver, domRecord} = require('./observer-cm-dom.cjs');

module.exports = class AcceptanceObserver extends Plugin {
  async onload() {
    // This fixture-only plugin cannot initialize in a personal vault or a non-Linux host.
    C.check(process.platform === 'linux', 'linux-observer-only');
    this.root = this.app.vault.adapter.getBasePath();
    C.check(/^\/tmp\/numerals-acceptance-[a-zA-Z0-9]+\/Numerals Acceptance NA13B$/.test(this.root), 'fixture-location');
    this.config = JSON.parse(fs.readFileSync(C.within(this.root, '.acceptance-config.json'), 'utf8'));
    C.guard(this.root, this.config);
    this.catalog = JSON.parse(fs.readFileSync(C.within(this.root, '.acceptance-catalog.json'), 'utf8'));
    C.catalogCheck(this.catalog);
    C.check(C.hash(fs.readFileSync(C.within(this.root, '.acceptance-catalog.json'))) === this.config.catalogSha256, 'fixture-catalog');
    this.allowedNotes = new Set(this.catalog.scenarios.flatMap(s => s.notes.map(n => n.path)));
    this.journal = new Journal(); this.ids = new Identities(); this.ownership = new Ownership(this.journal, this.ids);
    this.state = new StateObserver(this.ownership, this.ids, this.journal);
    this.stops = new Map(); this.windowStops = new Map(); this.leaves = new Map(); this.dead = false;
    this.register(() => this.dispose());
    this.stopVault = observeVault(this.app.vault, this.allowedNotes, this.journal);
    this.addWindow(this.app.workspace.containerEl.ownerDocument.defaultView, 'main');
    this.registerEvent(this.app.workspace.on('window-open', (workspaceWindow, win) => {
      if (!this.pendingPopout) { this.journal.fault('unexpected-window'); return; }
      try { this.pendingPopout.observe(workspaceWindow, win); } catch { this.journal.fault('window-ownership'); }
    }));
    this.registerEvent(this.app.workspace.on('window-close', (_workspaceWindow, win) => {
      this.windowStops.get(win)?.(); this.windowStops.delete(win); this.ownership.removeWindow(win); this.reconcile();
      this.journal.emit('window-close', {windowId: this.ids.id(win, 'window')});
    }));
    for (const name of ['layout-change', 'file-open', 'active-leaf-change', 'editor-change']) this.registerEvent(this.app.workspace.on(name, () => this.reconcile()));
    for (const name of ['changed', 'dataview:api-ready', 'dataview:index-ready', 'dataview:metadata-change']) {
      this.registerEvent(this.app.metadataCache.on(name, (...args) => {
        const file = name === 'dataview:metadata-change' ? args[1] : args[0];
        if (name.endsWith('ready') || this.allowedNotes.has(file?.path)) this.journal.emit('metadata-event', {name, sourcePath: file?.path ?? null,
          eventType: name === 'dataview:metadata-change' && typeof args[0] === 'string' ? args[0] : null});
      }));
    }
    for (const name of ['modify', 'create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(name, file => {
      if (this.allowedNotes.has(file.path)) this.journal.emit('vault-event', {name, sourcePath: file.path});
    }));
    this.registerEditorExtension(cmObserver({ViewPlugin, editorInfoField, editorLivePreviewField, Transaction}, this));
    for (const phase of ['before-native', 'after-native']) this.registerMarkdownPostProcessor((el, context) => {
      try { const record = domRecord(el, context, this, phase); if (record) this.journal.emit('markdown-dom', record); }
      catch { this.journal.fault('dom-observation-gap'); }
    }, phase === 'before-native' ? -1000 : 1000);
    this.reconcile();
  }
  plugin(id) { return typeof this.app.plugins?.getPlugin === 'function' ? this.app.plugins.getPlugin(id) : null; }
  addWindow(win, role, workspaceWindow) {
    const owner = this.ownership.addWindow(win, {document: win.document, role, workspaceWindow});
    C.check(!Object.hasOwn(win, '__numeralsAcceptance'), 'bridge-exists');
    const bridge = Object.freeze({hello: nonce => {
      C.check(nonce === this.config.nonce && !this.dead, 'bridge-identity'); C.guard(this.root, this.config);
      return {id: C.ID, nonce, root: this.root, windowId: owner.id, role, appMatches: win.app === this.app || role === 'main'};
    }, call: (nonce, operation) => this.call(nonce, operation)});
    Object.defineProperty(win, '__numeralsAcceptance', {value: bridge, configurable: true});
    this.windowStops.set(win, () => { if (Object.getOwnPropertyDescriptor(win, '__numeralsAcceptance')?.value === bridge) delete win.__numeralsAcceptance; });
    this.journal.emit('window-open', {windowId: owner.id, role}); return owner;
  }
  reconcile() {
    if (this.dead || !this.ownership) return;
    try {
      const present = new Set();
      this.app.workspace.iterateAllLeaves(leaf => {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || !view.file || !this.allowedNotes.has(view.file.path) || !view.containerEl.isConnected) return;
        const win = view.containerEl.ownerDocument.defaultView;
        if (!this.ownership.windows.has(win)) { this.journal.fault('unowned-editor-window'); return; }
        const editor = view.editor;
        if (!editor || editor.getValue() !== view.getViewData() || this.app.vault.getAbstractFileByPath(view.file.path) !== view.file) return;
        present.add(editor); const owner = this.ownership.addEditor(editor, {view, file: view.file, window: win, leaf});
        this.leaves.set(this.ids.id(leaf, 'leaf'), leaf);
        if (!this.stops.has(editor)) this.stops.set(editor, observeEditor(editor, this.ownership, this.journal));
        if (this.stops.get(editor).isInstalled?.()) this.journal.emit('editor-wrapper-ready', {wrapperSessionId: this.stops.get(editor).wrapperSessionId, editorId: owner.id, windowId: owner.windowId, sourcePath: owner.file.path});
        else this.journal.fault('editor-wrapper-gap');
        this.journal.emit('editor-owner', {editorId: owner.id, windowId: owner.windowId, leafId: this.ids.id(leaf, 'leaf'), sourcePath: view.file.path});
      });
      for (const [editor, stop] of this.stops) if (!present.has(editor)) { stop(); this.stops.delete(editor); this.ownership.editors.delete(editor); }
      this.state.reconcile(this.plugin('numerals'));
    } catch { this.journal.fault('owner-reconcile-gap'); }
  }
  actionOwner(leaf, expected) {
    const view = leaf?.view, editor = view?.editor, owner = editor && this.ownership.current(editor);
    C.check(owner && leaf && !this.dead && this.app.vault.adapter.getBasePath() === this.root && owner?.leaf === leaf && owner?.view === view &&
      this.allowedNotes.has(owner.file.path) && this.app.vault.getAbstractFileByPath(owner.file.path) === owner.file, 'action-current-owner');
    if (expected) C.check(owner.id === expected.id && owner.view === expected.view && owner.file === expected.file && owner.window === expected.window, 'action-owner-changed');
    return owner;
  }
  observe() {
    this.reconcile();
    for (const [editor, owner] of this.ownership.editors) {
      this.actionOwner(owner.leaf, owner);
      const nodes = owner.view.containerEl.querySelectorAll('.numerals-block, .numerals-inline');
      if (nodes.length > 2000) { this.journal.fault('dom-node-limit'); continue; }
      this.journal.emit('surface', {editorId: owner.id, windowId: owner.windowId, sourcePath: owner.file.path,
        buffer: editor.getValue(), mode: owner.view.getMode(),
        occurrences: [...nodes].map(node => ({id: this.ids.id(node, 'element'), text: node.textContent.slice(0, 16384),
          classes: node.className, connected: node.isConnected, mathJax: node.querySelectorAll('mjx-container').length}))});
    }
  }
  async call(nonce, operation) {
    C.check(!this.dead && nonce === this.config.nonce, 'bridge-identity'); C.guard(this.root, this.config);
    C.check(operation && typeof operation.op === 'string', 'bridge-operation');
    const {op} = operation;
    if (op === 'drain') return this.journal.drain();
    if (op === 'dispose') { this.unload(); return {disposed: true, mode: 'instrumented', cleanup: this.journal.drain()}; }
    if (op === 'observe') { this.observe(); return {observed: true}; }
    if (op === 'beginCase') {
      C.check(this.catalog.cases.some(c => c.id === operation.caseId) && this.journal.context.caseId === null, 'case-identity');
      this.journal.context = {caseId: operation.caseId, actionId: null, phase: 'case'}; return {begun: true};
    }
    if (op === 'endCase') { this.observe(); this.journal.context = {caseId: null, actionId: null, phase: 'between'}; return {ended: true}; }
    C.check(this.journal.context.caseId && /^action-\d+$/.test(operation.actionId || ''), 'action-identity');
    this.journal.context.actionId = operation.actionId;
    if (op === 'open' || op === 'split' || op === 'popout') {
      C.check(this.allowedNotes.has(operation.path), 'action-path');
      const file = this.app.vault.getAbstractFileByPath(operation.path); C.check(file, 'action-file');
      C.check(!this.creatingLeaf, 'leaf-operation-pending');
      const target = operation.leafId ? this.leaves.get(operation.leafId) : undefined;
      if (operation.leafId) this.actionOwner(target);
      // Targeted splits need a verified native split-relative-to-leaf driver.
      C.check(!(op === 'split' && operation.target), 'targeted-split-driver-pending');
      let leaf;
      if (op === 'open' && target) leaf = target;
      else {
        let count = 0; this.app.workspace.iterateAllLeaves(() => count++);
        C.check(count < C.LIMITS.editors, 'editor-limit');
      }
      this.creatingLeaf = true;
      try {
      if (op === 'popout') {
        C.check(!this.pendingPopout && this.ownership.windows.size < C.LIMITS.windows, 'popout-limit');
        this.pendingPopout = new PopoutTicket();
        leaf = this.app.workspace.openPopoutLeaf(); this.pendingPopout.setLeaf(leaf);
        try {
          let proof;
          while (!(proof = this.pendingPopout.proof(this.app))) {
            await new Promise((resolve, reject) => { this.popoutWait = {reject, timer: setTimeout(() => { this.popoutWait = undefined; resolve(); }, 25)}; });
            C.check(!this.dead, 'popout-cancelled');
          }
          this.addWindow(proof.win, 'popout', proof.workspaceWindow);
        } finally { this.pendingPopout?.cancel(); this.pendingPopout = undefined; }
      }
      else if (!leaf) leaf = this.app.workspace.getLeaf(op === 'split' ? 'split' : false);
      const id = this.ids.id(leaf, 'leaf'); this.leaves.set(id, leaf);
      await leaf.setViewState({type: 'markdown', active: true, state: {file: operation.path, mode: 'source'}});
      C.check(!this.dead && leaf.view.file === file, 'action-owner-changed'); this.reconcile(); this.actionOwner(leaf);
      return {leafId: id, windowId: this.ownership.windows.get(leaf.view.containerEl.ownerDocument.defaultView)?.id};
      } finally { this.creatingLeaf = false; }
    }
    const leaf = this.leaves.get(operation.leafId), owner = this.actionOwner(leaf);
    const view = owner.view, editor = view.editor;
    if (op === 'sample') { this.observe(); this.actionOwner(leaf, owner); return {sampled: true, texts: [...view.containerEl.querySelectorAll('.numerals-block, .numerals-inline')].slice(0, 2000).map(node => node.textContent.slice(0, 16384))}; }
    if (op === 'close') { leaf.detach(); this.reconcile(); return {closed: true}; }
    if (op === 'mode') {
      C.check(['reading', 'source', 'live-preview'].includes(operation.mode), 'action-mode');
      await leaf.setViewState({type: 'markdown', state: {file: view.file.path, mode: operation.mode === 'reading' ? 'preview' : 'source'}});
      C.check(!this.dead, 'action-cancelled'); this.reconcile(); this.actionOwner(leaf, owner); return {requested: operation.mode, actual: leaf.view.getMode(), livePreview: 'see-cm-evidence'};
    }
    if (op === 'focus') { this.app.workspace.setActiveLeaf(leaf, {focus: true}); this.actionOwner(leaf, owner); editor.focus(); this.actionOwner(leaf, owner); return {focused: true}; }
    if (op === 'select') { C.check(Number.isInteger(operation.from) && Number.isInteger(operation.to) && operation.from >= 0 && operation.to >= operation.from && operation.to <= editor.getValue().length, 'action-selection'); editor.setSelection(editor.offsetToPos(operation.from), editor.offsetToPos(operation.to)); return {selected: true}; }
    if (op === 'scroll') { C.check(Number.isInteger(operation.offset) && operation.offset >= 0 && operation.offset <= editor.getValue().length, 'action-scroll'); const pos = editor.offsetToPos(operation.offset); editor.scrollIntoView({from: pos, to: pos}, true); return {scrolled: true}; }
    if (op === 'dataview') {
      C.check(this.config.integration === 'dataview', 'integration-not-selected');
      const api = this.plugin('dataview')?.api; if (typeof api?.page !== 'function') return {available: false};
      const page = api.page(view.file.path); const value = page && Object.getOwnPropertyDescriptor(page, 'dvValue');
      const record = {sourcePath: view.file.path, available: Boolean(page), dvValue: value && 'value' in value && ['number', 'string', 'boolean'].includes(typeof value.value) ? value.value : null};
      this.journal.emit('dataview-page', record); return record;
    }
    // UI command invocation and trusted typing are controller/CDP operations, never fabricated here.
    throw Error('bridge-operation-unavailable');
  }
  dispose() {
    if (this.dead) return; this.dead = true;
    const release = fn => { try { fn(); } catch { this.journal?.fault('observer-cleanup-failed'); } };
    release(() => this.pendingPopout?.cancel());
    release(() => { if (this.popoutWait) { clearTimeout(this.popoutWait.timer); this.popoutWait.reject(Error('popout-cancelled')); this.popoutWait = undefined; } });
    release(() => this.stopVault?.()); this.stopVault = undefined;
    release(() => this.state?.dispose());
    for (const stop of this.stops?.values() ?? []) release(stop); this.stops?.clear();
    for (const stop of this.windowStops?.values() ?? []) release(stop); this.windowStops?.clear();
    release(() => this.ownership?.dispose()); this.leaves?.clear();
    if (this.journal) { this.journal.emit('observer-disposed'); this.journal.closed = true; }
  }
};
