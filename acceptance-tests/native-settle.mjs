import C from './contracts.cjs';
import {cancellable} from './cancellation.mjs';
import N from './native-sample.cjs';

/** A bounded current-state observation interval, not a pending-work/evaluation counter. */
export async function settleCurrent({capture, request, mode, signal, now = () => performance.now(),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 10000, stableMs = 250, pollMs = 100}) {
  C.check([timeoutMs, stableMs, pollMs].every(Number.isFinite) && timeoutMs >= 1000 && timeoutMs <= 10000 &&
    stableMs >= 250 && stableMs <= 2000 && stableMs < timeoutMs && pollMs >= 50 && pollMs <= 500, 'settle-bounds');
  const frames = [], started = now();
  let key, stableSince, lastAssessment;
  const read = async () => {
    const sample = await cancellable(capture, signal, Math.max(1, timeoutMs - (now() - started)));
    C.check(!signal?.aborted, 'controller-cancelled');
    sample.controllerElapsedMs = now() - started;
    frames.push(sample);
    C.check(frames.length <= 205 && Buffer.byteLength(JSON.stringify(frames)) <= C.LIMITS.bytes, 'sample-evidence-limit');
    return sample;
  };
  try {
    while (now() - started < timeoutMs) {
      const sample = await read(), assessment = N.sampleAssessment(sample, request, mode);
      lastAssessment = assessment;
      if (assessment.status === 'PASS' || assessment.status === 'FAIL') {
        const nextKey = N.stabilityKey(sample);
        if (key !== nextKey) { key = nextKey; stableSince = now(); }
        if (now() - stableSince >= stableMs) {
          // Re-enter the host and recheck ownership/generation after the stability interval.
          const seal = await read(), sealed = N.sampleAssessment(seal, request, mode);
          if ((sealed.status === 'PASS' || sealed.status === 'FAIL') && N.stabilityKey(seal) === key) return {
            status: sealed.status, reason: sealed.reason, scope: sealed.scope, sample: seal, frames,
            settling: {method: 'current-identity-and-dom-interval-with-seal', elapsedMs: now() - started, stableMs: now() - stableSince,
              requiredStableMs: stableMs, timeoutMs, pollMs,
              allPendingWorkDrained: false, evaluationCount: null},
          };
          lastAssessment = sealed; key = undefined; stableSince = undefined;
        }
      } else { key = undefined; stableSince = undefined; }
      await cancellable(() => pause(pollMs), signal, pollMs + 1000);
    }
    return {status: lastAssessment?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'FAIL', reason: 'current-sample-settle-timeout',
      lastAssessment, frames, settling: {elapsedMs: now() - started, allPendingWorkDrained: false, evaluationCount: null}};
  } catch (error) {
    error.sampleEvidence = {status: 'FAIL', reason: 'current-sample-interrupted', frames, lastAssessment,
      settling: {elapsedMs: now() - started, allPendingWorkDrained: false, evaluationCount: null}};
    throw error;
  }
}

/** Reassess retained frames; a status string or an earlier matching observation is insufficient. */
export function verifySettlement(result, request, mode) {
  const unavailable = reason => ({status: 'UNAVAILABLE', reason});
  if (!result || !Array.isArray(result.frames) || result.frames.length < 2 || result.frames.length > 205) return unavailable('settlement-frames');
  const {frames, settling} = result;
  if (settling?.method !== 'current-identity-and-dom-interval-with-seal' || settling.allPendingWorkDrained !== false || settling.evaluationCount !== null ||
    !['requiredStableMs', 'timeoutMs', 'pollMs', 'elapsedMs', 'stableMs'].every(key => Number.isFinite(settling[key])) ||
    settling.requiredStableMs < 250 || settling.requiredStableMs > 2000 || settling.timeoutMs < 1000 || settling.timeoutMs > 10000 ||
    settling.pollMs < 50 || settling.pollMs > 500 || settling.elapsedMs < 0 || settling.elapsedMs > settling.timeoutMs ||
    settling.stableMs < settling.requiredStableMs || settling.stableMs > settling.elapsedMs) return unavailable('settlement-method');
  let previousTime = -1, previousSequence = -1, key, stableSince;
  for (const frame of frames) {
    if (!Number.isFinite(frame.controllerElapsedMs) || frame.controllerElapsedMs < previousTime || frame.controllerElapsedMs > settling.timeoutMs ||
      !Number.isSafeInteger(frame.recordSequence) || frame.recordSequence <= previousSequence) return unavailable('settlement-order');
    previousTime = frame.controllerElapsedMs; previousSequence = frame.recordSequence;
    const assessment = N.sampleAssessment(frame, request, mode);
    if (assessment.status !== 'PASS' && assessment.status !== 'FAIL') { key = undefined; stableSince = undefined; continue; }
    const next = N.stabilityKey(frame);
    if (next !== key) { key = next; stableSince = frame.controllerElapsedMs; }
  }
  const last = frames.at(-1), penultimate = frames.at(-2);
  if (!key || JSON.stringify(result.sample) !== JSON.stringify(last) || N.stabilityKey(penultimate) !== key ||
    penultimate.controllerElapsedMs - stableSince < settling.requiredStableMs) return unavailable('settlement-final-seal');
  return N.sampleAssessment(last, request, mode);
}
