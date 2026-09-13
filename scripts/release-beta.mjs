import { execFileSync } from 'node:child_process';
import { assertCleanWorktree, assertReleaseAbsent, assertReviewedCommit, git, readCandidate, RECOVERY_BRANCH } from './release-policy.mjs';

try {
    const { version } = readCandidate();
    assertCleanWorktree();
    if (git('branch', '--show-current') !== RECOVERY_BRANCH) {
        throw new Error(`Only the owner on ${RECOVERY_BRANCH} may create a recovery prerelease tag.`);
    }
    git('fetch', '--no-tags', 'origin',
        `+refs/heads/${RECOVERY_BRANCH}:refs/remotes/origin/${RECOVERY_BRANCH}`,
        '+refs/heads/master:refs/remotes/origin/master');
    assertReviewedCommit();
    const reviewedHead = git('rev-parse', 'HEAD');
    if (reviewedHead !== git('rev-parse', `origin/${RECOVERY_BRANCH}`)) {
        throw new Error('Release only the current reviewed integration tip.');
    }
    if (git('tag', '--list', version) || git('ls-remote', '--tags', 'origin', `refs/tags/${version}`)) {
        throw new Error(`Tag ${version} already exists; never move tags. Bump the candidate version.`);
    }
    assertReleaseAbsent(version, 'gtg922r/obsidian-numerals');
    execFileSync('npm', ['ci'], { stdio: 'inherit' });
    execFileSync('npm', ['run', 'check'], { stdio: 'inherit' });
    assertCleanWorktree();
    readCandidate(version);
    if (git('rev-parse', 'HEAD') !== reviewedHead) throw new Error('HEAD changed during validation.');
    git('tag', version, reviewedHead);
    // A failed push leaves the local tag for owner inspection; never force/replace it.
    execFileSync('git', ['push', 'origin', `refs/tags/${version}:refs/tags/${version}`], { stdio: 'inherit' });
    console.log(`Pushed ${version}. GitHub Actions will create a BRAT prerelease with make_latest:false.`);
} catch (error) {
    console.error(`Prerelease stopped: ${error.message}`);
    process.exitCode = 1;
}
