import C from './contracts.cjs';

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
export function validateFamily(plan, observations) {
  const {records, faults} = observations;
  C.check(Array.isArray(records) && Array.isArray(faults), 'evidence-schema');
  for (let i = 0; i < records.length; i++) C.check(Number.isSafeInteger(records[i].sequence) && (i === 0 || records[i].sequence > records[i - 1].sequence), 'evidence-order');
  return plan.cases.map(c => {
    const own = records.filter(r => r.caseId === c.id && r.sourcePath === c.path), results = c.assertions.map(a => assertionResult(a, own, faults));
    // This increment verifies individual assertions, never the entire 83-row acceptance contract.
    const status = !own.length ? 'NOT_RUN' : results.some(r => r.status === 'FAIL') ? 'FAIL' : 'PARTIAL';
    return {id: c.id, status, scope: 'bounded-assertions-only', assertions: results};
  });
}
