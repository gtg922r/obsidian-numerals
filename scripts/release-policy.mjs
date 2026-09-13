import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const RECOVERY_BRANCH = 'chore/recovery-1.11';
export const STABLE_MANIFEST_BLOB = 'a8f7f565d79833c333f77f4acfc3e540a8c69b14';
export const STABLE_VERSIONS_BLOB = '51aa485d3ba838dcef42ab89206b36d4e2e07136';
const HISTORICAL_VERSIONS_SHA256 = 'b22a24bcecf33760e5319eae5439fc2ba5041478f19d58c743f57b6dc0199e01';

export function git(...args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function assertCandidateVersion(version) {
    if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
        throw new Error(`Expected a production-shaped candidate version, received: ${version}`);
    }
    const parts = version.split('.').map(Number);
    if (parts.some(part => !Number.isSafeInteger(part)) || parts[0] < 1 || (parts[0] === 1 && parts[1] < 11)) {
        throw new Error('Recovery candidates start at 1.11.0; stable 1.10.2 is protected.');
    }
    return parts;
}

export function readCandidate(tag) {
    const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
    const pkg = readJson('package.json');
    const lock = readJson('package-lock.json');
    const manifest = readJson('manifest.json');
    assertCandidateVersion(pkg.version);
    if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version || manifest.version !== pkg.version) {
        throw new Error('Candidate package, lockfile (both versions), and manifest must be synchronized.');
    }
    if (pkg.name !== lock.name || pkg.name !== lock.packages[''].name || manifest.id !== 'numerals') {
        throw new Error('Candidate package identity or Numerals plugin id is inconsistent.');
    }
    if (manifest.minAppVersion !== '1.13.0') {
        throw new Error('Recovery candidates require minAppVersion 1.13.0.');
    }
    if (tag !== undefined && tag !== pkg.version) {
        throw new Error(`Tag ${tag} does not match reviewed package version ${pkg.version}.`);
    }
    const historyHash = createHash('sha256').update(readFileSync('versions.json')).digest('hex');
    if (historyHash !== HISTORICAL_VERSIONS_SHA256) {
        throw new Error('Historical versions.json must remain byte-for-byte unchanged during recovery.');
    }
    return { pkg, lock, manifest, version: pkg.version };
}

export function assertStableMetadata(ref = 'origin/master') {
    if (git('rev-parse', `${ref}:manifest.json`) !== STABLE_MANIFEST_BLOB ||
        git('rev-parse', `${ref}:versions.json`) !== STABLE_VERSIONS_BLOB) {
        throw new Error('Stable master distribution metadata differs from the protected 1.10.2 baseline.');
    }
}

export function assertReviewedCommit() {
    // Only integration commits are eligible, including earlier reviewed candidates.
    git('merge-base', '--is-ancestor', 'HEAD', `origin/${RECOVERY_BRANCH}`);
    assertStableMetadata();
}

export function assertCleanWorktree() {
    if (git('status', '--porcelain')) {
        throw new Error('Commit or stash changes before creating a prerelease tag.');
    }
}

export function assertReleaseAbsent(version, repository) {
    // Listing must succeed. A network/auth/API failure is never treated as absence.
    const tags = execFileSync('gh', ['api', '--paginate', `repos/${repository}/releases?per_page=100`, '--jq', '.[].tag_name'], { encoding: 'utf8' });
    if (tags.split(/\r?\n/).includes(version)) {
        throw new Error(`Release ${version} already exists. Never replace or promote it; use a new candidate version.`);
    }
}
