import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

test('retired currency engines are collectable while retained formatters keep unload cleanup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'numerals-currency-gc-'));
  try {
    const bundle = path.join(directory, 'runtime.mjs');
    await build({
      stdin: { contents: `export { NumeralsSettingsRuntime } from './src/settings/runtimeState';\nexport { createDefaultSettings } from './src/settings/normalization';`, resolveDir: process.cwd() },
      outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
      plugins: [{ name: 'no-host-runtime', setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test-host' }));
        build.onLoad({ filter: /.*/, namespace: 'test-host' }, () => ({ contents: 'export class TFile {} export const renderMath = () => { throw Error("No host UI"); }; export const loadMathJax = renderMath; export const finishRenderMath = renderMath; export const sanitizeHTMLToDom = renderMath;' }));
      } }],
    });
    const script = path.join(directory, 'check.mjs');
    await writeFile(script, `
      import assert from 'node:assert/strict';
      import { setImmediate } from 'node:timers/promises';
      import { NumeralsSettingsRuntime, createDefaultSettings } from './runtime.mjs';
      const runtime = new NumeralsSettingsRuntime(() => []);
      const settings = createDefaultSettings();
      runtime.prepare(settings).activate();
      let retained = runtime.context;
      const formatter = retained.formatter;
      const oldEngine = new WeakRef(retained.engine);
      const value = retained.engine.evaluate('1$');
      retained = undefined;
      const unused = [];
      for (let i = 0; i < 8; i++) {
        settings.dollarSymbolCurrency.currency = i % 2 ? 'CAD' : 'AUD';
        runtime.prepare(settings).activate();
        unused.push(new WeakRef(runtime.context.engine));
      }
      unused.pop(); // The currently active engine remains strongly owned.
      for (let i = 0; i < 20; i++) { await setImmediate(); global.gc(); }
      assert.equal(unused.filter(reference => reference.deref()).length, 0, 'unused retired engines must be collectable');
      assert.equal(formatter.format(value).canonical, '1.00 USD');
      const engine = oldEngine.deref();
      assert.ok(engine, 'a retained formatter keeps its engine alive');
      assert.equal(engine.parse.isAlpha('€', '', ''), true);
      runtime.dispose();
      assert.equal(engine.parse.isAlpha('€', '', ''), false, 'retained engine cleanup remains available until unload');
    `);
    const result = spawnSync(process.execPath, ['--expose-gc', script], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
