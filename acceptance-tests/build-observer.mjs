import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import C from './contracts.cjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
export async function buildObserver() {
  const result = await build({absWorkingDir: directory, entryPoints: ['observer.cjs'], bundle: true, write: false,
    format: 'cjs', platform: 'node', target: 'es2018', external: ['obsidian', '@codemirror/view', '@codemirror/state'], metafile: true});
  C.check(Object.keys(result.metafile.inputs).every(name => !name.includes('node_modules') && !name.includes('..')), 'helper-bundle-inputs');
  return {bytes: Buffer.from(result.outputFiles[0].contents), inputs: Object.keys(result.metafile.inputs)};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {bytes, inputs} = await buildObserver(); await fs.mkdir(path.join(directory, 'dist'), {recursive: true});
  await fs.writeFile(path.join(directory, 'dist/main.js'), bytes);
  await fs.writeFile(path.join(directory, 'dist/build.json'), JSON.stringify({sha256: C.hash(bytes), size: bytes.length, inputs}, null, 2) + '\n');
  console.log(JSON.stringify({helperBuilt: true, sha256: C.hash(bytes), size: bytes.length}));
}
