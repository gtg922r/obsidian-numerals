import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

async function releaseBeta() {
    try {
        console.log("🚀 Starting beta release process...");
        
        // Read current package.json version
        const packageJson = JSON.parse(readFileSync("../package.json", "utf8"));
        const currentVersion = packageJson.version;
        
        console.log(`📦 Preparing beta release: ${currentVersion}`);
        
        // Update manifest-beta.json with current version
        let manifestBeta = JSON.parse(readFileSync("../manifest-beta.json", "utf8"));
        manifestBeta.version = currentVersion;
        writeFileSync("../manifest-beta.json", JSON.stringify(manifestBeta, null, "\t"));
        
        console.log("🔨 Building project...");
        
        // Run the build
        execSync("npm run build", { stdio: "inherit" });
        
        console.log("🏷️  Creating and pushing git tag...");
        
        // Create and push git tag
        execSync(`git add package.json manifest-beta.json`, { stdio: "inherit" });
        execSync(`git commit -m "Beta release ${currentVersion}"`, { stdio: "inherit" });
        execSync(`git tag ${currentVersion}`, { stdio: "inherit" });
        execSync(`git push origin`, { stdio: "inherit" });
        execSync(`git push origin ${currentVersion}`, { stdio: "inherit" });
        
        // Get current branch name for PR URL
        const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
        
        console.log(`✅ Beta release complete! Tagged as ${currentVersion}`);
        console.log("🚀 GitHub Actions will automatically build and publish the release.");
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
