import C from './contracts.cjs';
import {verifySettlement} from './native-settle.mjs';

/** Replay the plan's pane aliases from complete, returned action receipts. */
function currentLeaf(c, actions, lastIndex) {
  const aliases = new Map(); let leafId;
  for (let i = 0; i <= lastIndex; i++) {
    const planned = c.actions[i], actionId = `action-${i + 1}`;
    const entries = actions.filter(e => e.caseId === c.id && e.action?.actionId === actionId);
    if (!planned || entries.length !== 1 || entries[0].status !== 'returned') return;
    const entry = entries[0], action = entry.action, expectedLeaf = planned.target ? aliases.get(planned.target) : leafId;
    if (planned.target && !expectedLeaf || action.leafId !== expectedLeaf ||
      Object.entries(planned).some(([key, value]) => JSON.stringify(action[key]) !== JSON.stringify(value))) return;
    if (i === lastIndex) return expectedLeaf;
    if (['open', 'split', 'popout'].includes(planned.op)) {
      if (action.path !== (planned.path ?? c.path) || typeof entry.result?.leafId !== 'string' ||
        planned.op === 'open' && expectedLeaf && entry.result.leafId !== expectedLeaf) return;
      leafId = entry.result.leafId;
      if (planned.bind) { if (aliases.has(planned.bind)) return; aliases.set(planned.bind, leafId); }
    } else if (planned.op === 'close') {
      for (const [alias, bound] of aliases) if (bound === expectedLeaf) aliases.delete(alias);
      if (leafId === expectedLeaf) leafId = undefined;
    }
  }
}

function assertionResult(assertion, records, faults) {
  const unavailable = reason => ({kind: assertion.kind, status: 'UNAVAILABLE', reason});
  const result = ok => ({kind: assertion.kind, status: ok ? 'PASS' : 'FAIL'});
  if (['zero-evaluations', 'evaluation-count', 'pending-disposal'].includes(assertion.kind)) return unavailable('No faithful installed evaluator/disposal counter exists.');
  if (['dom-text', 'numeric-result'].includes(assertion.kind)) return unavailable('Final-value assertions require a reviewed current-state sample/settling driver; historical observations cannot satisfy them.');
  const observed = ok => ({kind: assertion.kind, status: ok ? 'OBSERVED' : 'NOT_OBSERVED', scope: 'historical-existence-only'});
  if (faults.length) return {kind: assertion.kind, status: 'PARTIAL', reason: 'Observer coverage fault.', faults};
  if (assertion.kind === 'observed-dom-text') {
    if (!records.some(r => r.kind === 'surface')) return unavailable('No owned rendered surface observation.');
    return observed(records.filter(r => r.kind === 'surface').some(r => r.occurrences.some(o => o.connected && o.text === assertion.text)));
  }
  if (assertion.kind === 'observed-numeric-result') {
    const states = records.filter(r => r.kind === 'snapshot' && r.available && r.sourceMatches && r.status === 'ready');
    if (!states.length) return unavailable('Installed editor snapshot seam unavailable.');
    return observed(states.some(r => r.calculations.some(c => c.calculationId === assertion.calculationId && c.rows.some(row => row.rowIndex === assertion.rowIndex && row.result === assertion.value))));
  }
  if (assertion.kind === 'one-write') {
    if (!/^action-[1-9][0-9]*$/.test(assertion.actionId ?? '')) return unavailable('One-write requires an explicit action interval.');
    const interval = records.filter(r => r.actionId === assertion.actionId);
    const starts = interval.filter(r => r.kind === 'editor-transaction-start'), ends = interval.filter(r => r.kind === 'editor-transaction-end');
    if (starts.some(r => r.source === 'unknown') || !records.some(r => r.kind === 'editor-wrapper-ready')) return unavailable('Transaction attribution/coverage unavailable.');
    const candidate = starts.filter(r => r.source === 'numerals');
    const end = ends.filter(r => r.source === 'numerals');
    const start = candidate[0], finish = end[0];
    const same = r => start && ['editorId', 'windowId', 'wrapperSessionId'].every(key => typeof start[key] === 'string' && r[key] === start[key]);
    const linked = r => same(r) && typeof start.transactionId === 'string' && r.transactionId === start.transactionId && r.actionId === start.actionId;
    return result(candidate.length === 1 && start.origin === 'numerals-insertion' &&
      records.some(r => r.kind === 'editor-wrapper-ready' && same(r) && r.sequence < start.sequence) &&
      end.length === 1 && linked(finish) && finish.sequence > start.sequence && !finish.threw && finish.stillOwned &&
      start.before === assertion.before && finish.before === assertion.before && finish.after === assertion.after &&
      interval.some(r => r.kind === 'cm-transaction' && linked(r) && r.sequence > start.sequence && r.sequence < finish.sequence &&
        r.before === assertion.before && r.after === assertion.after && r.userEvent === 'numerals-insertion'));
  }
  if (assertion.kind === 'native-input') {
    return result(records.some(r => {
      if (r.kind !== 'cm-transaction' || !r.docChanged || r.remote || r.history || r.witnessPrevented !== false) return false;
      const event = records.find(e => e.kind === 'native-input' && e.eventId === r.witnessEventId && e.editorId === r.editorId && e.startStateId === r.startStateId);
      if (!event || !event.trusted || event.prevented || event.composing || typeof event.data !== 'string' || event.selection?.ranges !== 1) return false;
      const {from, to} = event.selection;
      return r.after === r.before.slice(0, from) + event.data.replace(/\r\n?/g, '\n') + r.before.slice(to);
    }));
  }
  if (assertion.kind === 'no-background-writes') {
    const calls = records.filter(r => r.kind === 'vault-call' && r.pathClass === 'fixture-note');
    if (calls.some(r => r.source === 'numerals')) return result(false);
    return {kind: assertion.kind, status: 'PARTIAL', reason: 'No direct Numerals note call observed on wrapped APIs; other filesystem paths and transient writes are not proven absent.'};
  }
  return unavailable('Assertion has no reviewed installed observation implementation.');
}
export function validateFamily(plan, observations, actions = [], mode) {
  const {records, faults} = observations;
  C.check(Array.isArray(records) && Array.isArray(faults), 'evidence-schema');
  for (let i = 0; i < records.length; i++) C.check(Number.isSafeInteger(records[i].sequence) && (i === 0 || records[i].sequence > records[i - 1].sequence), 'evidence-order');
  return plan.cases.map(c => {
    const own = records.filter(r => r.caseId === c.id && (r.sourcePath === c.path || r.kind === 'current-sample' && r.source?.path === c.path));
    const results = c.assertions.map(a => {
      if (a.kind !== 'current-sample') return assertionResult(a, own, faults);
      const unavailable = reason => ({kind: a.kind, sampleId: a.sampleId, actionId: a.actionId, status: 'UNAVAILABLE', reason});
      const entries = actions.filter(e => e.caseId === c.id && e.action.actionId === a.actionId && e.action.op === 'current-sample');
      if (entries.length !== 1 || entries[0].status !== 'returned') return unavailable('current-action-unfinished');
      const entry = entries[0], selectedIndex = Number(a.actionId.slice(7)) - 1, selected = c.actions[selectedIndex], {request, currentSample} = entry.result ?? {};
      if (!request || selected?.sample?.id !== a.sampleId || request.id !== a.sampleId || request.caseId !== c.id || request.path !== c.path ||
        request.actionId !== a.actionId || request.leafId !== entry.action.leafId ||
        !request.leafId || request.leafId !== currentLeaf(c, actions, selectedIndex) || JSON.stringify(entry.request) !== JSON.stringify(request) ||
        ['expected', 'mode', 'target', 'sourceSha256'].some(key => JSON.stringify(request[key]) !== JSON.stringify(selected.sample[key]))) return unavailable('current-plan-binding');
      if (faults.length) return {kind: a.kind, sampleId: a.sampleId, status: 'PARTIAL', reason: 'current-coverage-fault', faults};
      const verified = verifySettlement(currentSample, request, mode);
      if (verified.status === 'PASS' || verified.status === 'FAIL') {
        const frames = currentSample.frames;
        // Replay every point read in this action, including unavailable intermediate reads.
        const reads = records.filter(r => r.kind === 'current-sample' && r.caseId === c.id && r.actionId === a.actionId);
        if (reads.length !== frames.length) return unavailable('current-frame-journal');
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i], record = reads[i];
          if (record.sequence !== frame.recordSequence || record.sampleId !== a.sampleId || record.leafId !== request.leafId ||
            Object.entries(frame).some(([key, value]) => key !== 'controllerElapsedMs' &&
              JSON.stringify(record[key]) !== JSON.stringify(value))) return unavailable('current-frame-journal');
        }
        // A later point read in the same requested action supersedes its seal, even if an earlier value matched.
        if (records.some(r => r.kind === 'current-sample' && r.caseId === c.id && r.actionId === a.actionId &&
          r.sequence > currentSample.sample.recordSequence)) return unavailable('current-seal-superseded');
        const seal = currentSample.sample;
        const later = records.filter(r => r.caseId === c.id && r.actionId === a.actionId && r.sequence > seal.recordSequence);
        if (later.some(r => r.kind === 'window-close' && r.windowId === request.owner.windowId) ||
          later.some(r => r.kind === 'editor-owner' && r.leafId === request.leafId && (r.editorId !== request.owner.editorId ||
            r.windowId !== request.owner.windowId || r.sourcePath !== request.path))) return unavailable('current-seal-invalidated');
        if (later.some(r => r.kind === 'cm-transaction' && r.editorId === request.owner.editorId && r.docChanged) ||
          later.some(r => r.kind === 'surface' && (r.editorId === request.owner.editorId || r.leafId === request.leafId) &&
            (r.buffer !== seal.source.text || r.mode !== 'preview' || r.sourcePath !== request.path))) return unavailable('current-seal-invalidated');
        for (const surface of later.filter(r => r.kind === 'surface' && (r.editorId === request.owner.editorId || r.leafId === request.leafId))) {
          const occurrences = surface.occurrences?.filter(o => o.id === seal.occurrence.elementId);
          if (!occurrences || occurrences.length !== 1 || !occurrences[0].connected || typeof seal.occurrence.codeText !== 'string' ||
            occurrences[0].text !== seal.occurrence.codeText) return unavailable('current-seal-invalidated');
        }
        if (mode === 'instrumented') {
          if (later.some(r => r.kind === 'capability' && r.snapshot === false)) return unavailable('current-seal-invalidated');
          if (later.some(r => r.kind === 'snapshot' && r.editorId === request.owner.editorId &&
            (!r.available || r.status !== 'ready' || !r.sourceMatches || r.sourceId !== seal.snapshot.sourceId || r.snapshotId !== seal.snapshot.snapshotId)) ||
            later.some(r => r.kind === 'settings' && (r.settingsGeneration !== seal.snapshot.settingsGeneration ||
              r.evaluationSettingsGeneration !== seal.snapshot.evaluationSettingsGeneration))) return unavailable('current-seal-invalidated');
        }
      }
      return {kind: a.kind, sampleId: a.sampleId, actionId: a.actionId, ...verified};
    });
    const current = c.assertions.filter(a => a.kind === 'current-sample');
    if (current.length > 1 && results.filter(r => r.kind === 'current-sample').every(r => r.status === 'PASS')) {
      const identities = current.map(a => {
        const sample = actions.find(e => e.caseId === c.id && e.action.actionId === a.actionId).result.currentSample.sample;
        return JSON.stringify({owner: sample.owner, source: sample.source, mode: sample.mode,
          snapshot: mode === 'instrumented' ? {sourceId: sample.snapshot.sourceId, indexId: sample.snapshot.indexId, stateId: sample.snapshot.stateId,
            snapshotId: sample.snapshot.snapshotId, pluginId: sample.snapshot.pluginId, generation: sample.snapshot.generation,
            settings: sample.snapshot.settings, settingsGeneration: sample.snapshot.settingsGeneration} : null});
      });
      if (new Set(identities).size !== 1) for (const result of results.filter(r => r.kind === 'current-sample')) {
        result.status = 'PARTIAL'; result.reason = 'separate-current-samples-changed-generation'; delete result.scope;
      }
    }
    // Sequential virtualized samples do not imply simultaneous visibility or a complete case pass.
    const status = !own.length ? 'NOT_RUN' : results.some(r => r.status === 'FAIL') ? 'FAIL' : 'PARTIAL';
    return {id: c.id, status, scope: 'bounded-assertions-only', assertions: results};
  });
}
