import { readFileSync, writeFileSync } from "fs";

function incrementVersion(currentVersion, type) {
    const parts = currentVersion.split('.').map(Number);
    
    switch (type) {
        case 'major':
            parts[0]++;
            parts[1] = 0;
            parts[2] = 0;
            break;
        case 'minor':
            parts[1]++;
            parts[2] = 0;
            break;
        case 'patch':
        default:
            parts[2]++;
            break;
    }
    
    return parts.join('.');
}

function updateVersion() {
    const versionType = process.argv[2] || 'patch';
    
    if (!['major', 'minor', 'patch'].includes(versionType)) {
        console.error('❌ Invalid version type. Use: major, minor, or patch');
        process.exit(1);
    }
    
    try {
        console.log(`🔢 Incrementing ${versionType} version...`);
        
        // Read current package.json
        const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
        const currentVersion = packageJson.version;
        
        // Calculate new version
        const newVersion = incrementVersion(currentVersion, versionType);
        
        console.log(`📦 Version: ${currentVersion} → ${newVersion}`);
        
        // Update package.json
        packageJson.version = newVersion;
        writeFileSync("package.json", JSON.stringify(packageJson, null, "\t"));
        
        console.log(`✅ Updated package.json to version ${newVersion}`);
        console.log(`💡 Run 'npm run release:beta' or 'npm run release:production' to build and deploy`);
        
    } catch (error) {
        console.error("❌ Version increment failed:", error.message);
        process.exit(1);
    }
}

updateVersion(); 
