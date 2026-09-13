import C from './contracts.cjs';

/** Reject promptly on cancellation, including when a dependency never settles. */
export function cancellable(work, signal, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let timer, done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); fn(value); };
    const cancel = () => finish(reject, Error('controller-cancelled'));
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, {once: true});
    timer = setTimeout(() => finish(reject, Error('controller-wait-deadline')), timeoutMs);
    Promise.resolve().then(() => { C.check(!signal?.aborted, 'controller-cancelled'); return work(); }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function childExit(child, signal) {
  return cancellable(() => new Promise((resolve, reject) => {
    const finish = () => { child.off('error', error); child.off('exit', exit); signal?.removeEventListener('abort', cleanup); };
    const error = () => { finish(); reject(Error('owned-child-error')); };
    const exit = code => { finish(); code === 0 ? resolve() : reject(Error('owned-child-exit')); };
    const cleanup = () => { finish(); reject(Error('controller-cancelled')); };
    child.once('error', error); child.once('exit', exit); signal?.addEventListener('abort', cleanup, {once: true});
    if (signal?.aborted) cleanup();
    else if (child.exitCode !== null || child.signalCode !== null) exit(child.exitCode);
  }), signal, 120000);
}

/** Abort independently starts termination, even if a caller is stuck awaiting a dependency. */
export function processTeardown(children, connections, kill = (pid, signal) => process.kill(pid, signal), graceMs = 500) {
  let started = false, timer;
  const send = signal => { for (const child of children) if (child.pid) { try { kill(-child.pid, signal); } catch {} } };
  return {
    start() {
      if (started) return; started = true;
      for (const connection of connections) { try { connection.close(); } catch {} }
      send('SIGTERM'); timer = setTimeout(() => send('SIGKILL'), graceMs);
    },
    async finish() {
      this.start();
      await new Promise(resolve => setTimeout(resolve, graceMs)); clearTimeout(timer); send('SIGKILL');
      return Promise.all([...children].map(child => !child.pid || child.exitCode !== null || child.signalCode !== null ? true : new Promise(resolve => {
        const end = value => { clearTimeout(deadline); child.off('exit', exit); resolve(value); }, exit = () => end(true);
        const deadline = setTimeout(() => end(false), 3000); child.once('exit', exit);
      })));
    },
  };
}
