import { writeFileSync } from 'node:fs';
import { assertCandidateVersion, git, readCandidate } from './release-policy.mjs';

try {
    const type = process.argv[2] ?? 'patch';
    if (!['major', 'minor', 'patch'].includes(type) || process.argv.length > 3) {
        throw new Error('Use version:patch, version:minor, or version:major.');
    }
    const branch = git('branch', '--show-current');
    if (!branch || ['master', 'main'].includes(branch)) {
        throw new Error('Bump candidate metadata only on a recovery feature/integration branch.');
    }
    const { pkg, lock, manifest, version } = readCandidate();
    const parts = assertCandidateVersion(version);
    const index = { major: 0, minor: 1, patch: 2 }[type];
    parts[index]++;
    for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
    const next = parts.join('.');
    assertCandidateVersion(next);
    pkg.version = lock.version = lock.packages[''].version = manifest.version = next;
    for (const [file, value, indent] of [['package.json', pkg, '\t'], ['package-lock.json', lock, '\t'], ['manifest.json', manifest, '\t']]) {
        writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
    }
    console.log(`Candidate ${version} → ${next}; package, lockfile and manifest synchronized. Commit for review before owner prerelease publication.`);
} catch (error) {
    console.error(`Version bump stopped: ${error.message}`);
    process.exitCode = 1;
}
