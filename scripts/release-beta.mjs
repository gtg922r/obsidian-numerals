import { readFileSync } from "fs";
import { execSync } from "child_process";

function readPackageVersion() {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const version = packageJson.version;

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Beta releases use production-shaped versions like 1.10.0. Found: ${version}`);
    }

    return version;
}

function assertCleanWorktree() {
    const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    if (status) {
        throw new Error("Commit or stash changes before creating a beta release tag.");
    }
}

async function releaseBeta() {
    try {
        console.log("🚀 Starting beta release process...");

        const currentVersion = readPackageVersion();

        console.log(`📦 Preparing beta release: ${currentVersion}`);
        console.log("🔎 Checking working tree...");
        assertCleanWorktree();

        console.log("🔨 Building project...");
        execSync("npm run build", { stdio: "inherit" });

        console.log("🏷️  Creating and pushing beta git tag...");
        execSync(`git tag ${currentVersion}`, { stdio: "inherit" });
        execSync(`git push origin ${currentVersion}`, { stdio: "inherit" });

        // Get current branch name for PR URL
        const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

        console.log(`✅ Beta release tag pushed: ${currentVersion}`);
        console.log("🚀 GitHub Actions will build a published prerelease for BRAT.");
        console.log(`📦 Release page: https://github.com/gtg922r/obsidian-numerals/releases/tag/${currentVersion}`);

        // Only show PR link if not on master branch
        if (currentBranch !== 'master') {
            console.log(`📋 Create PR: https://github.com/gtg922r/obsidian-numerals/compare/master...${currentBranch}?quick_pull=1&title=Beta%20Release%20${currentVersion}&body=Beta%20release%20for%20version%20${currentVersion}`);
        }

    } catch (error) {
        console.error("❌ Beta release failed:", error.message);
        process.exit(1);
    }
}

releaseBeta(); 
