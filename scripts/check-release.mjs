import { assertReviewedCommit, git, readCandidate } from './release-policy.mjs';

try {
    const args = process.argv.slice(2);
    let tag;
    let reviewed = false;
    while (args.length) {
        const arg = args.shift();
        if (arg === '--tag' && args.length) tag = args.shift();
        else if (arg === '--reviewed') reviewed = true;
        else throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    const { version } = readCandidate(tag);
    if (reviewed) {
        if (!tag) throw new Error('--reviewed requires --tag.');
        assertReviewedCommit();
        if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== git('rev-parse', 'HEAD')) {
            throw new Error('Release tag does not point to the checked-out reviewed commit.');
        }
    }
    console.log(`Validated Numerals ${version}; BRAT prerelease only, stable metadata protected.`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
