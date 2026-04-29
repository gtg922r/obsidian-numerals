import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const version = process.argv[2];
const pluginName = process.env.PLUGIN_NAME ?? "numerals";
const releaseRoot = "release";
const pluginDir = join(releaseRoot, pluginName);

if (!version) {
	console.error("Usage: node scripts/prepare-release-artifacts.mjs <version>");
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
	console.error(`Release tags must use production-shaped versions like 1.10.0. Received: ${version}`);
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (manifest.id !== pluginName) {
	console.error(`Manifest id "${manifest.id}" does not match plugin name "${pluginName}".`);
	process.exit(1);
}

for (const file of ["main.js", "styles.css"]) {
	if (!existsSync(file)) {
		console.error(`Missing required release artifact: ${file}`);
		process.exit(1);
	}
}

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });

manifest.version = version;
writeFileSync(join(pluginDir, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
copyFileSync("main.js", join(pluginDir, "main.js"));
copyFileSync("styles.css", join(pluginDir, "styles.css"));

execFileSync("zip", ["-r", `${pluginName}-${version}.zip`, pluginName], {
	cwd: releaseRoot,
	stdio: "inherit",
});

const releaseManifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8"));
if (releaseManifest.version !== version) {
	console.error(`Generated manifest version "${releaseManifest.version}" does not match tag "${version}".`);
	process.exit(1);
}

console.log(`Prepared release artifacts for ${pluginName} ${version}.`);
