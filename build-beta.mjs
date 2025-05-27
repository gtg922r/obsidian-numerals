import { readFileSync, writeFileSync, execSync } from "fs";

async function buildBeta() {
    try {
        console.log("🚀 Starting beta build process...");
        
        // Read current package.json version
        const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
        const currentVersion = packageJson.version;
        
        // Create beta version (append -beta.timestamp)
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
        const betaVersion = `${currentVersion}-beta.${timestamp}`;
        
        console.log(`📦 Building beta version: ${betaVersion}`);
        
        // Update manifest-beta.json with beta version
        let manifestBeta = JSON.parse(readFileSync("manifest-beta.json", "utf8"));
        manifestBeta.version = betaVersion;
        writeFileSync("manifest-beta.json", JSON.stringify(manifestBeta, null, "\t"));
        
        // Copy manifest-beta.json to manifest.json for build
        writeFileSync("manifest.json", JSON.stringify(manifestBeta, null, "\t"));
        
        console.log("🔨 Building project...");
        
        // Run the build
        execSync("npm run build", { stdio: "inherit" });
        
        console.log("🏷️  Creating git tag...");
        
        // Create and push git tag
        execSync(`git add manifest.json manifest-beta.json`, { stdio: "inherit" });
        execSync(`git commit -m "Beta release ${betaVersion}"`, { stdio: "inherit" });
        execSync(`git tag ${betaVersion}`, { stdio: "inherit" });
        execSync(`git push origin ${betaVersion}`, { stdio: "inherit" });
        
        console.log(`✅ Beta build complete! Tagged as ${betaVersion}`);
        console.log("🚀 GitHub Actions will automatically create the release.");
        
    } catch (error) {
        console.error("❌ Beta build failed:", error.message);
        process.exit(1);
    }
}

buildBeta(); 
