'use strict';
const {data} = require('./observer-core.cjs');
const {hash, LIMITS} = require('./contracts.cjs');

function safe(journal, fn) { try { return fn(); } catch { journal.fault('write-observation-gap'); } }
function caller(stack) {
  const frames = String(stack).split('\n').filter(line => /\bat\b/.test(line));
  // Helper is bundled under its own sourceURL. Never persist raw paths/stacks.
  const first = frames.find(line => !line.includes('plugin:numerals-recovery-acceptance-observer') && !line.includes('observer-writes.cjs'));
  if (!first) return 'unknown';
  if (/plugin:numerals(?::\d|\))/.test(first)) return 'numerals';
  if (/plugin:dataview(?::\d|\))/.test(first)) return 'dataview';
  return first.includes('app.js:') ? 'host' : 'unknown';
}
/** No await, Promise.resolve, then/catch, callback replacement or global prototype writes. */
function wrapMethod(object, method, journal, observe) {
  const own = Object.getOwnPropertyDescriptor(object, method);
  let inherited = own, p = object;
  while (!inherited && (p = Object.getPrototypeOf(p))) inherited = Object.getOwnPropertyDescriptor(p, method);
  if (!inherited || !('value' in inherited) || typeof inherited.value !== 'function') { journal.fault('method-unavailable'); return () => {}; }
  const original = inherited.value;
  function wrapper(...args) {
    const token = safe(journal, () => observe.before(this, args, caller(new Error().stack)));
    let threw = true;
    try {
      const result = Reflect.apply(original, this, args);
      threw = false;
      return result;
    } finally {
      safe(journal, () => observe.after(this, token, threw));
    }
  }
  try { Object.defineProperty(object, method, own ? {...own, value: wrapper} : {value: wrapper, writable: true, configurable: true}); }
  catch { journal.fault('method-unavailable'); return () => {}; }
  let restored = false;
  const stop = () => {
    if (restored) return; restored = true;
    const current = Object.getOwnPropertyDescriptor(object, method);
    if (current?.value !== wrapper) { journal.fault('wrapper-replaced'); return; }
    safe(journal, () => { if (own) Object.defineProperty(object, method, own); else delete object[method]; });
  };
  stop.installed = true;
  stop.isInstalled = () => Object.getOwnPropertyDescriptor(object, method)?.value === wrapper;
  return stop;
}
function observeEditor(editor, ownership, journal) {
  const wrapperSessionId = ownership.ids.id({}, 'editor-wrapper');
  const stop = wrapMethod(editor, 'transaction', journal, {
    before(receiver, args, source) {
      const owner = ownership.current(editor);
      if (receiver !== editor || !owner) throw Error('editor-coverage');
      const before = editor.getValue(); if (before.length > LIMITS.text) throw Error('text-limit');
      const token = {wrapperSessionId, transactionId: ownership.ids.id({}, 'editor-transaction'), editorId: owner.id, windowId: owner.windowId, sourcePath: owner.file.path, before, source,
        origin: typeof args[1] === 'string' ? args[1] : null, transaction: data(args[0])};
      const stack = ownership.transactions.get(editor) ?? []; stack.push(token); ownership.transactions.set(editor, stack);
      journal.emit('editor-transaction-start', token); return token;
    },
    after(receiver, token, threw) {
      if (!token) return;
      try {
        const after = editor.getValue(); if (after.length > LIMITS.text) throw Error('text-limit');
        const owner = ownership.current(editor);
        journal.emit('editor-transaction-end', {...token, after, threw, stillOwned: receiver === editor && owner?.id === token.editorId && owner?.windowId === token.windowId && owner?.file.path === token.sourcePath});
      } finally {
        const stack = ownership.transactions.get(editor);
        if (stack?.pop() !== token) journal.fault('editor-transaction-order');
        if (!stack?.length) ownership.transactions.delete(editor);
      }
    },
  });
  const owner = ownership.current(editor);
  if (stop.installed) journal.emit('editor-wrapper-ready', {wrapperSessionId, editorId: owner?.id, windowId: owner?.windowId, sourcePath: owner?.file.path});
  stop.wrapperSessionId = wrapperSessionId;
  return stop;
}
function observeVault(vault, allowedNotes, journal) {
  const stops = [], active = []; let serial = 0;
  const methods = ['modify', 'modifyBinary', 'append', 'process', 'create', 'createBinary', 'rename', 'delete', 'trash'];
  const adapterMethods = ['write', 'writeBinary', 'append', 'process', 'rename', 'remove', 'mkdir', 'rmdir', 'trashSystem', 'trashLocal'];
  for (const [object, layer, names] of [[vault, 'vault', methods], [vault.adapter, 'adapter', adapterMethods]]) {
    if (!object) { journal.fault('adapter-unavailable'); continue; }
    for (const method of names) {
      // Optional platform methods are explicitly unavailable, not fatal to other coverage.
      if (typeof object[method] !== 'function') { journal.emit('capability', {layer, method, available: false}); continue; }
      stops.push(wrapMethod(object, method, journal, {
        before(receiver, args, source) {
          const raw = typeof args[0] === 'string' ? args[0] : args[0]?.path;
          const note = allowedNotes.has(raw), config = typeof raw === 'string' && /^\.obsidian\/[a-zA-Z0-9_./-]+$/.test(raw) && !raw.split('/').includes('..');
          const pathClass = note ? 'fixture-note' : config ? 'fixture-config' : 'unexpected';
          if (pathClass === 'unexpected') journal.fault('unexpected-write-path');
          const value = args[1];
          const token = {callId: ++serial, parentId: active.at(-1) ?? null, layer, method, source, pathClass,
            sourcePath: note ? raw : null, receiverMatches: receiver === object,
            payload: typeof value === 'string' ? {length: value.length, sha256: hash(value)} : {type: typeof value}};
          active.push(token.callId); journal.emit('vault-call', token); return token;
        },
        after(_receiver, token, threw) {
          if (!token) return;
          if (active.pop() !== token.callId) journal.fault('vault-call-order');
          journal.emit('vault-return', {callId: token.callId, threw, completion: 'not-observed'});
        },
      }));
      journal.emit('capability', {layer, method, available: true});
    }
  }
  return () => { for (const stop of stops.reverse()) stop(); };
}
module.exports = {wrapMethod, observeEditor, observeVault, caller};
