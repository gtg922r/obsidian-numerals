import C from './contracts.cjs';

export class Connection {
  constructor(socket) {
    this.socket = socket; this.serial = 0; this.pending = new Map(); this.closed = false;
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch { this.close(); return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(Error('cdp-protocol')); else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => this.close()); socket.addEventListener('error', () => this.close());
  }
  async request(method, params = {}, ms = 10000) {
    C.check(!this.closed && this.pending.size < 10, 'cdp-closed');
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('cdp-deadline')); }, ms);
      this.pending.set(id, {resolve, reject, timer});
      try { this.socket.send(JSON.stringify({id, method, params})); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(Error('cdp-send')); }
    });
  }
  async evaluate(expression) {
    const result = await this.request('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    C.check(!result.exceptionDetails, 'cdp-expression'); return result.result?.value;
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('cdp-closed')); } this.pending.clear();
    this.socket.close();
  }
}
export async function connect(target, port) {
  const url = new URL(target.webSocketDebuggerUrl);
  C.check(url.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port) === port && !url.username && !url.password, 'cdp-loopback');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('cdp-connect-deadline')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('cdp-connect')); }, {once: true});
  });
  return new Connection(socket);
}
/** about:blank is admitted only by a matching, expected popout bridge. */
export function targetProof(target, hello, expected) {
  C.check(target.type === 'page' && (target.url.startsWith('app://obsidian.md/') || target.url === 'about:blank'), 'target-url');
  C.check(hello?.id === C.ID && hello.nonce === expected.nonce && hello.root === expected.root && hello.appMatches === true &&
    hello.windowId === expected.windowId && hello.role === expected.role, 'target-proof');
  if (target.url === 'about:blank') C.check(expected.role === 'popout', 'target-role');
  return hello.windowId;
}
