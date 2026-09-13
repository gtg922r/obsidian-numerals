import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {cancellable, childExit, processTeardown} from '../cancellation.mjs';
import {extractionArgs, finalizeEvidence} from '../run.mjs';
import {plan} from './support.mjs';

test('cancellation interrupts a hung dependency, including one that later rejects', async () => {
  const abort = new AbortController(); let reject;
  const pending = cancellable(() => new Promise((_resolve, fail) => { reject = fail; }), abort.signal);
  await Promise.resolve(); abort.abort(); await assert.rejects(pending, /controller-cancelled/); reject(Error('late'));
});
test('hung owned child wait aborts and independent termination reaches both signals', async () => {
  const abort = new AbortController(), child = Object.assign(new EventEmitter(), {pid: 1234, exitCode: null, signalCode: null}), calls = [];
  const teardown = processTeardown(new Set([child]), new Set([{close() { calls.push('close'); }}]), (...args) => calls.push(args), 5);
  abort.signal.addEventListener('abort', () => teardown.start());
  const pending = childExit(child, abort.signal); await Promise.resolve(); abort.abort();
  await assert.rejects(pending, /controller-cancelled/); await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(calls, ['close', [-1234, 'SIGTERM'], [-1234, 'SIGKILL']]);
  child.exitCode = 0; assert.deepEqual(await teardown.finish(), [true]);
});
test('unconfirmed process exit invalidates previously passing bounded claims and fails the run', () => {
  const p = plan(), result = finalizeEvidence(p, {observations: {records: [{sequence: 1, caseId: 'ORD-01', sourcePath: p.cases[0].path, kind: 'surface', occurrences: [{connected: true, text: '14'}]}], faults: []}}, false);
  assert.equal(result.failure.reason, 'owned-process-exit-unconfirmed'); assert.equal(result.results[0].assertions[0].status, 'PARTIAL');
});
test('7z uses scratch-relative arguments for its mapped WASM cwd', () => {
  assert.deepEqual(extractionArgs('/helper/7z.js', '/tmp/scratch', '/tmp/scratch/app.AppImage', '/tmp/scratch/installer'), ['/helper/7z.js', 'x', 'app.AppImage', '-oinstaller']);
  assert.throws(() => extractionArgs('/helper', '/tmp/scratch', '/outside/file', '/tmp/scratch/installer'), /extraction-path/);
});
