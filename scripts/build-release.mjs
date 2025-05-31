import { readFileSync, writeFileSync, execSync } from "fs";

async function buildRelease() {
    try {
        console.log("🚀 Starting release build process...");
        
        // Read current package.json version
        const packageJson = JSON.parse(readFileSync("../package.json", "utf8"));
        const targetVersion = packageJson.version;
        
        console.log(`📦 Building release version: ${targetVersion}`);
        
        // Update manifest.json with release version
        let manifest = JSON.parse(readFileSync("../manifest.json", "utf8"));
        const { minAppVersion } = manifest;
        manifest.version = targetVersion;
        writeFileSync("../manifest.json", JSON.stringify(manifest, null, "\t"));
        
        // Update versions.json with target version and minAppVersion
        let versions = JSON.parse(readFileSync("../versions.json", "utf8"));
        versions[targetVersion] = minAppVersion;
        writeFileSync("../versions.json", JSON.stringify(versions, null, "\t"));
        
        console.log("🔨 Building project...");
        
        // Run the build
        execSync("npm run build", { stdio: "inherit" });
        
        console.log("🏷️  Creating git tag...");
        
        // Create and push git tag
        execSync(`git add manifest.json versions.json`, { stdio: "inherit" });
        execSync(`git commit -m "Release ${targetVersion}"`, { stdio: "inherit" });
        execSync(`git tag ${targetVersion}`, { stdio: "inherit" });
        execSync(`git push origin ${targetVersion}`, { stdio: "inherit" });
        
        console.log(`✅ Release build complete! Tagged as ${targetVersion}`);
        console.log("🚀 GitHub Actions will automatically create the release.");
        
    } catch (error) {
        console.error("❌ Release build failed:", error.message);
        process.exit(1);
    }
}

buildRelease(); 
