/** Serialized controller action handles only: no observer plugin, wrappers, CM extension or listeners. */
export function installControl(config, native) {
  const app = window.app;
  if (app.vault.adapter.getBasePath() !== config.root || app.plugins.getPlugin('numerals-recovery-acceptance-observer')) throw Error('control-identity');
  const leaves = new Map(), owners = new Map(), windows = new Map([[window, 'control-window-1']]);
  let serial = 0, sequence = 0, caseId = null, actionId = null, dead = false, creatingLeaf = false;
  const records = [], bridges = new Map();
  const check = value => { if (!value || dead || app.vault.adapter.getBasePath() !== config.root) throw Error('control-guard'); };
  const emit = (kind, value) => { check(records.length < 20000); records.push({sequence: ++sequence, at: performance.now(), caseId, actionId, kind, ...value}); };
  function current(leaf, expected) {
    const owner = owners.get(leaf), view = leaf?.view;
    check(owner && owner.view === view && view.editor === owner.editor && view.file === owner.file && view.file.path === owner.path &&
      view.containerEl.isConnected && view.containerEl.ownerDocument === owner.document && owner.document === owner.win.document &&
      !owner.win.closed && windows.has(owner.win) && owner.win.app === app && config.paths.includes(owner.path) &&
      app.vault.getAbstractFileByPath(owner.path) === owner.file);
    if (expected) check(owner === expected);
    return owner;
  }
  function observe() {
    for (const [leafId, leaf] of leaves) {
      const {view} = current(leaf);
      const buffer = view.editor.getValue(); check(buffer.length <= 262144);
      const nodes = [...view.containerEl.querySelectorAll('.numerals-block, .numerals-inline')]; check(nodes.length <= 2000);
      emit('surface', {leafId, sourcePath: view.file.path, buffer, mode: view.getMode(), windowId: windows.get(view.containerEl.ownerDocument.defaultView),
        occurrences: nodes.map(node => ({text: node.textContent.slice(0, 16384), classes: node.className, connected: node.isConnected, mathJax: node.querySelectorAll('mjx-container').length}))});
    }
  }
  async function call(nonce, operation) {
    check(nonce === config.nonce);
    const {op} = operation;
    if (op === 'drain') return {records: records.splice(0), faults: [], sequence};
    if (op === 'beginCase') { check(caseId === null && config.caseIds.includes(operation.caseId)); caseId = operation.caseId; return {begun: true}; }
    if (op === 'endCase') { observe(); caseId = null; actionId = null; return {ended: true}; }
    if (op === 'observe') { observe(); return {observed: true}; }
    if (op === 'dispose') { for (const [win, bridge] of bridges) if (Object.getOwnPropertyDescriptor(win, '__numeralsAcceptanceControl')?.value === bridge) delete win.__numeralsAcceptanceControl; dead = true; owners.clear(); leaves.clear(); return {disposed: true, mode: 'control', cleanup: {records: records.splice(0), faults: []}}; }
    check(caseId && /^action-\d+$/.test(operation.actionId)); actionId = operation.actionId;
    if (['open', 'split', 'popout'].includes(op)) {
      check(config.paths.includes(operation.path) && !creatingLeaf);
      const target = operation.leafId ? leaves.get(operation.leafId) : undefined;
      if (operation.leafId) current(target);
      check(!(op === 'split' && operation.target));
      if (op !== 'open' || !target) {
        let count = 0; app.workspace.iterateAllLeaves(() => count++); check(count < 6);
      }
      creatingLeaf = true;
      try {
      if (op === 'popout') check(windows.size < 2);
      const leaf = op === 'open' && target ? target : op === 'popout' ? app.workspace.openPopoutLeaf() : app.workspace.getLeaf(op === 'split' ? 'split' : false);
      await leaf.setViewState({type: 'markdown', active: true, state: {file: operation.path, mode: 'source'}}); check(leaf.view.file?.path === operation.path);
      const win = leaf.view.containerEl.ownerDocument.defaultView;
      if (!windows.has(win)) { check(op === 'popout' && win.app === app); windows.set(win, 'control-window-2'); addBridge(win, 'popout'); }
      owners.set(leaf, {view: leaf.view, editor: leaf.view.editor, file: leaf.view.file, path: operation.path, document: leaf.view.containerEl.ownerDocument, win, window: win, leaf});
      current(leaf);
      const existing = [...leaves].find(([, value]) => value === leaf), leafId = existing?.[0] ?? `control-leaf-${++serial}`; leaves.set(leafId, leaf);
      return {leafId, windowId: windows.get(win)};
      } finally { creatingLeaf = false; }
    }
    const leaf = leaves.get(operation.leafId), owner = current(leaf), editor = owner.editor;
    if (op === 'current-owner') { check(native); return {owner: native.proof(leaf, owner, operation.leafId)}; }
    if (op === 'current-read') {
      check(native && operation.request?.caseId === caseId && operation.request.actionId === actionId && operation.request.leafId === operation.leafId);
      const frame = native.capture(leaf, current, operation.request, operation.leafId);
      frame.recordSequence = sequence + 1; emit('current-sample', frame); return frame;
    }
    if (op === 'reveal') {
      check(Number.isSafeInteger(operation.line) && operation.line >= 0 && operation.line < editor.getValue().split(/\r\n?|\n/).length);
      leaf.view.setEphemeralState({line: operation.line}); current(leaf, owner);
      return {setup: 'public-ephemeral-line', nativeInteraction: false, requestedLine: operation.line};
    }
    if (op === 'sample') { observe(); current(leaf, owner); return {sampled: true, texts: [...leaf.view.containerEl.querySelectorAll('.numerals-block, .numerals-inline')].slice(0, 2000).map(node => node.textContent.slice(0, 16384))}; }
    if (op === 'focus') { app.workspace.setActiveLeaf(leaf, {focus: true}); current(leaf, owner); editor.focus(); current(leaf, owner); return {focused: true}; }
    if (op === 'select') { check(Number.isInteger(operation.from) && Number.isInteger(operation.to) && operation.from >= 0 && operation.to >= operation.from && operation.to <= editor.getValue().length); editor.setSelection(editor.offsetToPos(operation.from), editor.offsetToPos(operation.to)); return {selected: true}; }
    if (op === 'scroll') { check(Number.isInteger(operation.offset) && operation.offset >= 0 && operation.offset <= editor.getValue().length); const pos = editor.offsetToPos(operation.offset); editor.scrollIntoView({from: pos, to: pos}, true); return {scrolled: true}; }
    if (op === 'mode') { check(['reading', 'source', 'live-preview'].includes(operation.mode)); await leaf.setViewState({type: 'markdown', state: {file: leaf.view.file.path, mode: operation.mode === 'reading' ? 'preview' : 'source'}}); current(leaf, owner); return {requested: operation.mode, actual: leaf.view.getMode()}; }
    if (op === 'close') { leaf.detach(); leaves.delete(operation.leafId); owners.delete(leaf); return {closed: true}; }
    return {available: false, reason: 'control-operation-unavailable'};
  }
  function addBridge(win, role) {
    check(!Object.hasOwn(win, '__numeralsAcceptanceControl'));
    const bridge = Object.freeze({hello(nonce) { check(nonce === config.nonce); return {id: 'numerals-installed-acceptance-NA13B', nonce, root: config.root, windowId: windows.get(win), role, appMatches: win.app === app}; }, call});
    Object.defineProperty(win, '__numeralsAcceptanceControl', {value: bridge, configurable: true}); bridges.set(win, bridge);
  }
  addBridge(window, 'main'); return {installed: true};
}
