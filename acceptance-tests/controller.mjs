import C from './contracts.cjs';
import {cancellable} from './cancellation.mjs';
import {settleCurrent} from './native-settle.mjs';

/** Awaited operations cannot continue a case after cancellation or a failed owner check. */
export async function runFamily(backend, plan, catalog, signal) {
  C.planCheck(plan, catalog);
  const actions = [], observations = {records: [], faults: []};
  const family = {mode: backend.mode, actions, observations, diskBlobs: backend.diskBlobs};
  let evidenceBytes = 0;
  const bound = value => { evidenceBytes += Buffer.byteLength(JSON.stringify(value)); C.check(evidenceBytes <= C.LIMITS.bytes, 'controller-byte-limit'); };
  const wait = work => cancellable(work, signal);
  const live = () => { C.check(!signal.aborted, 'controller-cancelled'); backend.assertOwned(); };
  const drain = async () => {
    const chunk = await wait(() => backend.drain()); live();
    bound(chunk); observations.records.push(...chunk.records); observations.faults.push(...chunk.faults);
    C.check(observations.records.length <= C.LIMITS.events, 'controller-event-limit');
  };
  try {
    for (const c of plan.cases) {
      live(); await wait(() => backend.begin(c.id)); live();
      let leafId; const aliases = new Map();
      for (let i = 0; i < c.actions.length; i++) {
        C.check(!c.actions[i].target || aliases.has(c.actions[i].target), 'action-alias-unresolved');
        const action = {...c.actions[i], actionId: `action-${i + 1}`, leafId: c.actions[i].target ? aliases.get(c.actions[i].target) : leafId};
        if (['open', 'split', 'popout'].includes(action.op)) action.path ??= c.path;
        live(); actions.push({caseId: c.id, action, status: 'started'});
        if (backend.captureDisk) { actions.at(-1).diskBefore = await wait(() => backend.captureDisk()); live(); }
        let result;
        if (action.op === 'current-sample') {
          const proof = await wait(() => backend.action({...action, op: 'current-owner'})); live();
          const request = {...action.sample, caseId: c.id, actionId: action.actionId, leafId: action.leafId, path: c.path, owner: proof?.owner};
          actions.at(-1).request = request;
          try {
            result = {request, currentSample: await settleCurrent({request, mode: backend.mode, signal,
              capture: async () => { live(); const frame = await backend.action({...action, op: 'current-read', request}); live(); return frame; }})};
          } catch (error) {
            actions.at(-1).result = {request, currentSample: error.sampleEvidence};
            throw error;
          }
        } else result = await wait(() => backend.action(action));
        live();
        bound(result ?? null); C.check(!action.bind || typeof result?.leafId === 'string', 'action-binding-unavailable');
        if (result?.leafId) leafId = result.leafId;
        if (action.bind && result?.leafId) aliases.set(action.bind, result.leafId);
        Object.assign(actions.at(-1), {status: 'returned', result});
        if (backend.captureDisk) { actions.at(-1).diskAfter = await wait(() => backend.captureDisk()); live(); }
        await drain();
      }
      await wait(() => backend.end(c.id)); live(); await drain();
    }
    return family;
  } catch (error) { error.familyEvidence = family; throw error; }
  finally {
    try {
      const receipt = await cancellable(() => backend.dispose(), undefined, Math.min(backend.cleanupTimeoutMs ?? 10000, 10000));
      const cleanup = receipt?.cleanup; bound(cleanup ?? null);
      if (Array.isArray(cleanup?.records)) observations.records.push(...cleanup.records);
      if (Array.isArray(cleanup?.faults)) observations.faults.push(...cleanup.faults);
      C.check(receipt?.disposed === true && receipt.mode === (backend.mode === 'instrumented' ? 'instrumented' : 'control') &&
        Array.isArray(cleanup?.records) && Array.isArray(cleanup?.faults), 'backend-cleanup-unconfirmed');
    } catch {
      observations.faults.push('backend-cleanup-unconfirmed');
      family.failure = {stage: 'cleanup', reason: 'backend-cleanup-unconfirmed'};
    }
  }
}

/** Fixed keyboard surface: no arbitrary CDP method supplied by a scenario. */
export async function nativeAction(connection, action, alive = () => {}) {
  alive();
  if (action.op === 'type') {
    C.check(typeof action.text === 'string' && action.text.length <= 1024, 'native-text');
    await connection.request('Input.insertText', {text: action.text}); return {submitted: true, proof: 'requires-observed-native-event'};
  }
  const keys = {Enter: {key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13}, Escape: {key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27},
    Undo: {key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2}, Redo: {key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 10}};
  C.check(action.op === 'key' && Object.hasOwn(keys, action.key), 'native-key');
  await connection.request('Input.dispatchKeyEvent', {type: 'keyDown', ...keys[action.key]});
  alive(); await connection.request('Input.dispatchKeyEvent', {type: 'keyUp', ...keys[action.key]}); return {submitted: true};
}
