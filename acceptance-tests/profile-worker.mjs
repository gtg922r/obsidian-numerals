// Owned preparation process: its temporary files stay beneath the parent's scratch TMPDIR.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import Launcher from 'obsidian-launcher';
import C from './contracts.cjs';
const execution = JSON.parse(await fs.readFile(new URL('./execution.json', import.meta.url)));
C.check(execution.enabled === true, 'host-execution-wiring-disabled');
const scratch = process.cwd(), params = JSON.parse(await fs.readFile(path.join(scratch, 'profile-input.json')));
C.check(process.platform === 'linux' && process.env.TMPDIR === scratch && /^\/tmp\/numerals-acceptance-[a-zA-Z0-9]+$/.test(scratch), 'profile-worker-root');
const inputs = JSON.parse(await fs.readFile(new URL('./inputs.json', import.meta.url)));
C.check(Object.keys(params).sort().join() === 'appPath,appVersion,installerVersion,vault' && params.appPath === path.join(scratch, 'obsidian.asar') && params.vault === path.join(scratch, 'Numerals Acceptance NA13B') && params.appVersion === inputs.host.version && params.installerVersion === inputs.host.version, 'profile-worker-inputs');
C.check(C.hash(await fs.readFile(params.appPath)) === inputs.host.app.uncompressedSha256, 'profile-worker-app');
const launcher = new Launcher({cacheDir: path.join(scratch, 'cache'), versionsUrl: pathToFileURL(path.join(scratch, 'versions.json')).href,
  communityPluginsUrl: pathToFileURL(path.join(scratch, 'empty.json')).href, communityThemesUrl: pathToFileURL(path.join(scratch, 'empty.json')).href, interactive: false});
const profile = await launcher.setupConfigDir(params);
C.check(path.dirname(profile) === scratch && (await fs.realpath(profile)) === profile, 'profile-location');
await fs.writeFile(path.join(scratch, 'profile-output.json'), JSON.stringify({profile}));
