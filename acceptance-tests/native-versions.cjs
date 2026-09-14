'use strict';
function versions(win, apiVersion) {
  let host = null;
  try { const app = win.electron?.remote?.app; if (typeof app?.getVersion === 'function') host = app.getVersion(); } catch {}
  return {host: typeof host === 'string' ? host : null, api: typeof apiVersion === 'string' ? apiVersion : null,
    mathJax: typeof win.MathJax?.version === 'string' ? win.MathJax.version : null};
}
module.exports = {versions};
