import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Stable maintenance may change tooling/docs, but never these 1.10.2 inputs.
// Keep this guard separate from recovery's candidate/publication validation.
const protectedBlobs = {
    'package.json': '144806e2f7aec3e4a4958d6d3a838c10ddeed22a',
    'package-lock.json': '08c79a35a2010a810505a3a9f32a58171e8c1dcb',
    'manifest.json': 'a8f7f565d79833c333f77f4acfc3e540a8c69b14',
    'versions.json': '51aa485d3ba838dcef42ab89206b36d4e2e07136',
};
const stableSourceTree = 'b0080c36d599722f58f4f8498acb399caf915088';

try {
    for (const [file, expected] of Object.entries(protectedBlobs)) {
        const bytes = readFileSync(file);
        const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (hash !== expected) throw new Error(`Protected stable file changed: ${file}`);
    }
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    if (git('rev-parse', 'HEAD:src') !== stableSourceTree) {
        throw new Error('Committed plugin source differs from stable 1.10.2.');
    }
    git('diff', '--no-ext-diff', '--exit-code', 'HEAD', '--', 'src/');
    if (git('ls-files', '--others', '--', 'src/')) {
        throw new Error('Untracked plugin source is not allowed in stable maintenance.');
    }
    console.log('Stable 1.10.2 package, lockfile, manifest, version mappings and plugin source are unchanged.');
} catch (error) {
    console.error(`Stable maintenance check failed: ${error.message}`);
    process.exitCode = 1;
}
