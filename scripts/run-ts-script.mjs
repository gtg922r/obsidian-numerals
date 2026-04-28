import esbuild from 'esbuild';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const scriptPath = process.argv[2];
const scriptArgs = process.argv.slice(3);

if (!scriptPath) {
	console.error('Usage: node scripts/run-ts-script.mjs <script.ts>');
	process.exit(1);
}

const tempDir = await mkdtemp(path.join(tmpdir(), 'numerals-ts-script-'));
const outfile = path.join(tempDir, 'script.mjs');

try {
	process.argv = [process.argv[0], path.resolve(scriptPath), ...scriptArgs];
	process.env.NUMERALS_RUN_TS_SCRIPT = '1';

	await esbuild.build({
		entryPoints: [path.resolve(scriptPath)],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'es2018',
		outfile,
		logLevel: 'silent',
	});

	await import(pathToFileURL(outfile).href);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
