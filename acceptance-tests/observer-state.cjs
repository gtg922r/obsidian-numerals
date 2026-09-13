'use strict';
const {data} = require('./observer-core.cjs');
const {hash, LIMITS} = require('./contracts.cjs');

function snapshotRecord(plugin, editor, ownership, ids, epoch) {
  const owner = ownership.current(editor); if (!owner) return;
  const source = plugin.getEditorSnapshot(editor); if (!source) return {editorId: owner.id, epoch, available: false};
  const state = source.state, snapshot = state.status === 'ready' ? state.snapshot : undefined;
  const generation = snapshot?.generation ?? state.generation;
  const text = editor.getValue();
  if (text.length > LIMITS.text) throw Error('text-limit');
  return {editorId: owner.id, windowId: owner.windowId, sourcePath: owner.file.path, epoch, available: true, sourceId: source.sourceId,
    status: state.status, snapshotId: snapshot ? ids.id(snapshot, 'snapshot') : null,
    generation: data(generation), sourceMatches: generation.sourceId === source.sourceId && generation.sourceText === text && generation.sourcePath === owner.file.path,
    editorSha256: hash(text), insertionExhausted: source.insertionExhausted,
    metadataStatus: snapshot?.metadataStatus ?? null,
    calculations: snapshot ? data(snapshot.calculations) : [], diagnostics: snapshot ? data(snapshot.diagnostics) : [],
    error: state.status === 'error' ? String(state.message).slice(0, 4096) : null};
}
class StateObserver {
  constructor(ownership, ids, journal) { this.ownership = ownership; this.ids = ids; this.journal = journal; this.stops = new Map(); this.epoch = 0; }
  reconcile(plugin) {
    if (this.plugin !== plugin) {
      this.clear(); this.stop(this.stopSettings); this.stopSettings = undefined; this.plugin = plugin; this.epoch++;
      if (typeof plugin?.subscribeSettingsChanges === 'function') {
        const epoch = this.epoch, emit = () => {
          if (this.plugin !== plugin || this.epoch !== epoch) return;
          try { this.journal.emit('settings', {epoch, settingsGeneration: plugin.settingsGeneration,
            evaluationSettingsGeneration: plugin.evaluationSettingsGeneration, configurationError: plugin.configurationError ?? null, settings: data(plugin.settings)}); }
          catch { this.journal.fault('settings-observation-gap'); }
        };
        this.stopSettings = plugin.subscribeSettingsChanges(emit); emit();
      }
    }
    const capable = plugin && typeof plugin.getEditorSnapshot === 'function' && typeof plugin.subscribeEditorSnapshot === 'function';
    if (!capable) { this.clear(); this.journal.emit('capability', {snapshot: false, evaluationCount: false}); return; }
    const currentSources = new Map();
    for (const editor of this.ownership.editors.keys()) {
      try { currentSources.set(editor, plugin.getEditorSnapshot(editor)); }
      catch { this.journal.fault('snapshot-unavailable'); }
    }
    for (const [editor, subscription] of this.stops) {
      const owner = this.ownership.current(editor);
      if (!owner || subscription.file !== owner.file || currentSources.get(editor)?.sourceId !== subscription.sourceId) { this.stops.delete(editor); this.stop(subscription.stop); }
    }
    for (const [editor, owner] of this.ownership.editors) if (!this.stops.has(editor)) {
      // This getter never attaches a source or requests math. Retry after later layout events.
      const current = currentSources.get(editor);
      if (!current) continue;
      const epoch = this.epoch, emit = () => {
        if (this.plugin !== plugin || epoch !== this.epoch) return;
        try { const record = snapshotRecord(plugin, editor, this.ownership, this.ids, epoch); if (record) this.journal.emit('snapshot', record); }
        catch { this.journal.fault('snapshot-observation-gap'); }
      };
      const stop = plugin.subscribeEditorSnapshot(editor, emit);
      if (typeof stop !== 'function') { this.journal.fault('snapshot-subscription'); continue; }
      this.stops.set(editor, {file: owner.file, sourceId: current.sourceId, stop}); emit();
    }
  }
  stop(fn) { try { fn?.(); } catch { this.journal.fault('state-cleanup-failed'); } }
  clear() { const subscriptions = [...this.stops.values()]; this.stops.clear(); for (const subscription of subscriptions) this.stop(subscription.stop); }
  dispose() { this.plugin = undefined; this.epoch++; this.clear(); this.stop(this.stopSettings); this.stopSettings = undefined; }
}
module.exports = {snapshotRecord, StateObserver};
