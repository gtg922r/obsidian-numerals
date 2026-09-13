import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { buildOptions } from '../../scripts/esbuild.config.mjs';

const require = createRequire(import.meta.url);
test('standalone source index bundles its private parser closure and keeps host CodeMirror external', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'numerals-source-index-bundle-'));
  try {
    const outfile = path.join(directory, 'source-index.cjs');
    const result = await build({ ...buildOptions, entryPoints: [path.resolve('src/evaluation/sourceIndex.ts')],
      outfile, metafile: true, sourcemap: false, logLevel: 'silent' });
    for (const dependency of ['common', 'highlight', 'markdown']) {
      assert.ok(Object.keys(result.metafile.inputs).some(input => input.includes(`node_modules/@lezer/${dependency}/`)), `${dependency} must be private`);
    }
    const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
    assert.ok(!imports.some(dependency => dependency.path.startsWith('@lezer/')), 'No runtime Lezer imports');
    for (const dependency of ['state', 'view', 'language']) assert.ok(buildOptions.external.includes(`@codemirror/${dependency}`));
    const { indexNote } = require(outfile);
    const text = '```math\n$x=2\n```\n\n`#:$x+1`';
    const index = indexNote({sourceId: 'test', revision: 1, text});
    assert.deepEqual(index.calculations.map(calculation => calculation.kind), ['block', 'inline']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
