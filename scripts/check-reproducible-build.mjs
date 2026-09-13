import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hash = () => createHash('sha256').update(readFileSync('main.js')).digest('hex');
const first = hash(); // Requires a preceding production build.
execFileSync(process.execPath, ['scripts/esbuild.config.mjs', 'production'], { stdio: 'inherit' });
if (hash() !== first) throw new Error('Repeated production builds produced different main.js bytes.');
console.log(`Reproducible main.js SHA-256: ${first}`);
