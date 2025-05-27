import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

async function releaseProduction() {
    try {
        console.log("🚀 Starting production release process...");
        
        // Read current package.json version
        const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
        const targetVersion = packageJson.version;
        
        console.log(`📦 Preparing production release: ${targetVersion}`);
        
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
        
        // Run the build
        execSync("npm run build", { stdio: "inherit" });
        
        console.log("🏷️  Creating and pushing git tag...");
        
        // Create and push git tag
        execSync(`git add package.json manifest.json versions.json`, { stdio: "inherit" });
        execSync(`git commit -m "Release ${targetVersion}"`, { stdio: "inherit" });
        execSync(`git tag ${targetVersion}`, { stdio: "inherit" });
        execSync(`git push origin`, { stdio: "inherit" });
        execSync(`git push origin ${targetVersion}`, { stdio: "inherit" });
        
        // Get current branch name for PR URL
        const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
        
        console.log(`✅ Production release complete! Tagged as ${targetVersion}`);
        console.log("🚀 GitHub Actions will automatically build and publish the release.");
        
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
