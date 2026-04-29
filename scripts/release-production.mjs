import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

function readPackageVersion() {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const version = packageJson.version;

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Production releases use versions like 1.10.0. Found: ${version}`);
    }

    return version;
}

async function releaseProduction() {
    try {
        console.log("🚀 Starting production promotion process...");

        const targetVersion = readPackageVersion();

        console.log(`📦 Promoting release: ${targetVersion}`);

        const localTag = execSync(`git tag --list ${targetVersion}`, { encoding: "utf8" }).trim();
        if (!localTag) {
            console.warn(`⚠️  No local tag named ${targetVersion}. Create and test the beta release before promoting.`);
        }

        // Update manifest.json with release version
        let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
        const { minAppVersion } = manifest;
        manifest.version = targetVersion;
        writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

        // Update versions.json with target version and minAppVersion
        let versions = JSON.parse(readFileSync("versions.json", "utf8"));
        versions[targetVersion] = minAppVersion;
        writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

        console.log("🔨 Building project...");
        execSync("npm run build", { stdio: "inherit" });

        console.log("📝 Committing stable release metadata...");
        execSync(`git add package.json manifest.json versions.json`, { stdio: "inherit" });
        execSync(`git commit -m "chore: release ${targetVersion}"`, { stdio: "inherit" });
        execSync(`git push origin`, { stdio: "inherit" });

        // Get current branch name for PR URL
        const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

        console.log(`✅ Stable metadata updated for ${targetVersion}`);
        console.log("🚀 Flip the existing GitHub release from prerelease to full release when ready.");
        console.log(`📦 Release page: https://github.com/gtg922r/obsidian-numerals/releases/tag/${targetVersion}`);

        // Only show PR link if not on master branch
        if (currentBranch !== 'master') {
            console.log(`📋 Create PR: https://github.com/gtg922r/obsidian-numerals/compare/master...${currentBranch}?quick_pull=1&title=Release%20${targetVersion}&body=Production%20release%20for%20version%20${targetVersion}`);
        }

    } catch (error) {
        console.error("❌ Production release failed:", error.message);
        process.exit(1);
    }
}

releaseProduction(); 
