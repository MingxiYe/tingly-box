// Install (if needed) and launch the desktop app. Shared by the
// tingly-box-gui shim and the `gui` / `app` subcommands of the tingly-box
// shim, so both start the app the same way.
//
// ctx: { shimUrl: the calling shim's import.meta.url,
//        ownVersion: its npm version,
//        version: parsed --transport-version ("latest" by default),
//        releaseTag: release tag baked in at publish time,
//        retryCmd: command shown in the "to retry" hint,
//        fromRegistry: when no platform package sits next to the shim (the
//          tingly-box CLI, which does not depend on the app), install the one
//          matching ownVersion from the npm registry; a version that was never
//          published is an error, not a fallback to another version }

import { execFileSync, spawn, spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { cacheDir } from "./cachedir.js";
import { cleanupRetiredInstallDirs, cleanupStaleBinaryCaches } from "./cleanup.js";
import { downloadAndExtractZip, extractZipFile } from "./download.js";
import { checkLibs, hasDisplay, readInstallHint, REQUIRED_LIBS } from "./linuxgui.js";
import { findPlatformPackage, GUI_PLATFORM_PACKAGES, guiPlatformPackage } from "./platform.js";

// Configuration for binary downloads
const BASE_URL = "https://github.com/tingly-dev/tingly-box/releases/download";

// Same scheme as the cli shim: prefer the @tingly-dev/tingly-box-gui-<os>-<cpu>
// package npm installed next to this one (registry only, no GitHub), but only
// at exactly this version; otherwise download the baked release tag.
function resolveSource(ctx) {
	if (ctx.version !== "latest") return { kind: "download", tag: ctx.version };
	const local = findPlatformPackage(ctx.shimUrl, GUI_PLATFORM_PACKAGES);
	if (local && local.version === ctx.ownVersion) {
		return { kind: "package", tag: `v${local.version}`, local };
	}
	if (ctx.fromRegistry) {
		return { kind: "registry", tag: `v${ctx.ownVersion}` };
	}
	if (local) {
		console.warn(`⚠️  ${local.name}@${local.version} does not match tingly-box-gui@${ctx.ownVersion}, downloading the release instead`);
	}
	return { kind: "download", tag: ctx.releaseTag };
}

// Install the GUI platform package at exactly `version` from the npm registry
// into `prefix` (only that package: no dependency tree to speak of, no
// scripts) and return it as findPlatformPackage would. Honours the user's npm
// config, so a mirror registry works. There is deliberately no fallback to
// another version or to the GitHub release: the app and the CLI must match.
function installFromRegistry(version, prefix, ctx) {
	const entry = guiPlatformPackage();
	const spec = `${entry.name}@${version}`;
	console.log(`📥 Fetching ${spec} from the npm registry...`);
	mkdirSync(prefix, { recursive: true });
	const win = process.platform === "win32";
	// npm.cmd needs a shell on Windows, which does not quote for us.
	const args = ["install", "--prefix", win ? `"${prefix}"` : prefix, "--no-save", "--no-audit", "--no-fund",
		"--ignore-scripts", "--loglevel=error", spec];
	const r = spawnSync(win ? "npm.cmd" : "npm", args, { encoding: "utf8", shell: win });
	if (r.error || r.status !== 0) {
		const out = `${r.stderr || ""}${r.stdout || ""}`;
		console.error(`\n❌ Could not install ${spec}`);
		if (r.error && r.error.code === "ENOENT") {
			console.error(`   npm was not found on PATH; it is needed to fetch the desktop app.`);
		} else if (/E404|ETARGET|notarget|404 Not Found/i.test(out)) {
			// ETARGET: the package exists but not at this version; E404: not at all.
			console.error(`   That version of the desktop app is not published on npm: the app is released`);
			console.error(`   separately from the CLI, and tingly-box ${version} has no matching app yet.`);
			console.error(`   Newest published app: npm view ${entry.name} version`);
			process.exit(1);
		} else if (out.trim()) {
			console.error(out.trim().split("\n").slice(-6).map((l) => `   ${l}`).join("\n"));
		}
		console.error(`\n🔄 To retry, run: ${ctx.retryCmd}`);
		process.exit(1);
	}
	const local = findPlatformPackage(pathToFileURL(join(prefix, "x.js")).href, GUI_PLATFORM_PACKAGES);
	if (!local || local.version !== version) {
		console.error(`\n❌ ${spec} installed but is not usable (found: ${local ? local.version : "nothing"})`);
		process.exit(1);
	}
	return local;
}

async function getPlatformArchAndBinary() {
	const platform = process.platform;
	const arch = process.arch;

	let platformDir;
	let archDir;
	let suffix = "";
	let appName = "TinglyBox.app";  // macOS app bundle name

	if (platform === "darwin") {
		platformDir = "macos";
		archDir = "arm64"; // the only macOS GUI build; Intel exits earlier
	} else if (platform === "linux") {
		platformDir = "linux";
		if (arch === "x64") archDir = "amd64";
		else if (arch === "ia32") archDir = "386";
		else archDir = arch; // fallback
	} else if (platform === "win32") {
		platformDir = "windows";
		if (arch === "x64") archDir = "amd64";
		else if (arch === "ia32") archDir = "386";
		else archDir = arch; // fallback
		suffix = ".exe";
	} else {
		console.error(`Unsupported platform/arch: ${platform}/${arch}`);
		process.exit(1);
	}

	return { platformDir, archDir, binaryName: "tingly-box-gui", suffix, appName };
}

// Linux: the app is a bare binary linking the system's GTK 3 / WebKitGTK 4.1.
// Check for a desktop session and those libraries before downloading
// anything, so a missing piece is named up front rather than surfacing as a
// linker error from a detached process.
function preflightLinux(releasesUrl) {
	if (!hasDisplay()) {
		console.error(`\n❌ No desktop session found (neither DISPLAY nor WAYLAND_DISPLAY is set)`);
		console.error(`   The desktop app needs a graphical session. Over SSH or in a container use the CLI instead:`);
		console.error(`   npx tingly-box`);
		process.exit(1);
	}
	const missing = checkLibs();
	if (missing && missing.length > 0) {
		console.error(`\n❌ Missing system libraries: ${missing.join(", ")}`);
		console.error(`   The Linux desktop app uses the system's GTK 3 and WebKitGTK 4.1`);
		console.error(`   (Ubuntu 22.04+, Debian 12+, Fedora 36+).`);
		const hint = readInstallHint();
		console.error(`\n💡 Install them${hint ? `:\n   ${hint}` : ` (${REQUIRED_LIBS.join(", ")}) with your package manager`}`);
		console.error(`   Or use the CLI, which needs no system libraries: npx tingly-box`);
		console.error(`   Newer distributions can install the .deb / .rpm instead: ${releasesUrl}`);
		process.exit(1);
	}
}

// Start the app detached so the shell prompt returns, but watch the first
// moments: a binary that dies at startup (a library the preflight could not
// see, a display it cannot open) would otherwise vanish silently.
function launchLinux(appPath, cacheRoot) {
	console.log(`🚀 Launching ${appPath}...`);
	const child = spawn(appPath, [], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (d) => { if (stderr.length < 4096) stderr += d; });
	child.on("error", (e) => {
		console.error(`\n❌ Failed to launch ${appPath}: ${e.message}`);
		console.error(`   Clear the cache and retry: rm -rf "${cacheRoot}"`);
		process.exit(1);
	});
	child.on("exit", (code, signal) => {
		// Exit 0: a running instance took over (the app is single-instance).
		if (code === 0) process.exit(0);
		console.error(`\n❌ ${appPath} exited right after start (${signal || `code ${code}`})`);
		if (stderr.trim()) console.error(stderr.trim().split("\n").map((l) => `   ${l}`).join("\n"));
		console.error(`\n💡 Use the CLI instead: npx tingly-box`);
		process.exit(code || 1);
	});
	setTimeout(() => {
		child.removeAllListeners("exit");
		child.stderr.destroy();
		child.unref();
	}, 2000);
}

export async function launchGui(ctx) {
	cleanupRetiredInstallDirs(dirname(fileURLToPath(ctx.shimUrl)));

	const platform = process.platform;

	const releasesUrl = "https://github.com/tingly-dev/tingly-box/releases/latest";
	let unsupported = null;
	if (platform === "linux" && process.arch !== "x64" && process.arch !== "arm64") {
		// Only amd64 and arm64 builds of the desktop app are published.
		unsupported = {
			name: "Linux on " + process.arch,
			status: ["The desktop app is built for x64 and arm64 Linux only"],
		};
	} else if (platform === "win32" && process.arch !== "x64") {
		unsupported = {
			name: "Windows on " + process.arch,
			status: ["The desktop app is built for x64 Windows only"],
		};
	} else if (platform === "darwin" && process.arch !== "arm64") {
		// Only an Apple Silicon build of the desktop app is published.
		unsupported = {
			name: "macOS on Intel",
			status: ["The desktop app is built for Apple Silicon Macs only"],
		};
	}
	if (unsupported) {
		console.error(`\n❌ ${unsupported.name} is not supported by npx tingly-box-gui`);
		console.error(`┌─ Status:`);
		for (const line of unsupported.status) console.error(`│  ${line}`);
		console.error(`└─ Platform: ${platform} (${process.arch})`);
		console.error(`\n💡 Alternatives:`);
		console.error(`   • Use the CLI version: npx tingly-box`);
		process.exit(1);
	}

	if (platform === "linux") {
		preflightLinux(releasesUrl);
	}

	// macOS (arm64), Windows (x64) and Linux (x64, arm64) continue: install, then launch.
	const platformInfo = await getPlatformArchAndBinary();
	const { platformDir, archDir, binaryName, suffix, appName } = platformInfo;

	const source = resolveSource(ctx);
	// Cache dir is keyed by the release tag, whichever way the app arrives.
	const branchName = source.tag;
	console.log(`Tingly Box desktop app ${branchName}`);

	const zipFileName = `${binaryName}-${platformDir}-${archDir}.zip`;
	const downloadUrl = `${BASE_URL}/${branchName}/${zipFileName}`;

	const cacheRoot = join(cacheDir(), "tingly-box-gui");
	const tinglyBinDir = join(cacheRoot, branchName, "bin");

	try {
		if (!existsSync(tinglyBinDir)) {
			mkdirSync(tinglyBinDir, { recursive: true });
		}
	} catch (mkdirError) {
		console.error(`❌ Failed to create directory ${tinglyBinDir}:`, mkdirError.message);
		process.exit(1);
	}

	// macOS: the .app bundle. Windows/Linux: the bare executable.
	const isMac = platform === "darwin";
	const appPath = isMac ? join(tinglyBinDir, appName) : join(tinglyBinDir, `tingly-box-gui${suffix}`);

	if (!existsSync(appPath)) {
		if (source.kind === "package") {
			console.log(`📦 Installing the app from ${source.local.name}@${source.local.version}...`);
			await extractZipFile(source.local.zipPath, tinglyBinDir);
		} else if (source.kind === "registry") {
			// Inside the tag dir so the stale-cache sweep removes it with the tag;
			// dropped right after extraction since the zip is only needed once.
			const pkgDir = join(cacheRoot, branchName, "pkg");
			try {
				const local = installFromRegistry(ctx.ownVersion, pkgDir, ctx);
				console.log(`📦 Installing the app from ${local.name}@${local.version}...`);
				await extractZipFile(local.zipPath, tinglyBinDir);
			} finally {
				rmSync(pkgDir, { recursive: true, force: true });
			}
		} else {
			await downloadAndExtractZip(downloadUrl, tinglyBinDir);
		}
		if (!existsSync(appPath)) {
			console.error(`❌ The package did not contain ${appPath}`);
			process.exit(1);
		}

		if (isMac) {
			// Make sure the binary inside the .app bundle is executable
			const appBinaryPath = join(appPath, "Contents", "MacOS", "tingly-box-gui");
			if (existsSync(appBinaryPath)) {
				chmodSync(appBinaryPath, 0o755);
			}
		}
		console.log(`✅ Installed to ${appPath}`);
	}

	// The app for this tag is in place — old tag dirs are now safe to GC.
	cleanupStaleBinaryCaches(cacheRoot, branchName);

	if (platform === "linux") {
		launchLinux(appPath, cacheRoot);
		return;
	}

	if (!isMac) {
		// Windows: start the exe detached so the shell prompt returns.
		console.log(`🚀 Launching ${appPath}...`);
		try {
			const child = spawn(appPath, [], { detached: true, stdio: "ignore" });
			child.on("error", (e) => {
				console.error(`\n❌ Failed to launch ${appPath}: ${e.message}`);
				console.error(`   Clear the cache and retry: rmdir /s /q "${cacheRoot}"`);
				process.exit(1);
			});
			child.unref();
		} catch (e) {
			console.error(`\n❌ Failed to launch ${appPath}: ${e.message}`);
			process.exit(1);
		}
		return;
	}

	console.log(`🔍 Launching app: ${appPath}`);

	// macOS: the app is only ad-hoc signed (no Developer ID). Extraction can
	// invalidate the bundle seal, so verify and re-sign ad hoc only when
	// needed. Neither npm nor this shim sets the quarantine flag, so
	// Gatekeeper never prompts on this path.
	try {
		execFileSync("codesign", ["--verify", "--deep", appPath], { stdio: "ignore" });
	} catch {
		try {
			console.log(`🔐 Signing app with ad-hoc signature...`);
			execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
			console.log(`✅ App signed successfully`);
		} catch (signError) {
			console.error(`⚠️  Warning: Failed to sign app: ${signError.message}`);
			console.error(`    Continuing anyway...`);
		}
	}

	// Launch the app using `open` command
	try {
		console.log(`🚀 Launching ${appName}...`);
		// Detach the app by using open command
		execFileSync("open", ["-a", appPath], {
			stdio: "inherit"
		});
		console.log(`✅ ${appName} launched successfully!`);
	} catch (execError) {
		console.error(`\n❌ Failed to launch ${appName}`);
		console.error(`┌─ Error Details:`);
		console.error(`│  Message: ${execError.message}`);

		const errorCode = execError.code;
		if (errorCode) {
			console.error(`│  Code: ${errorCode}`);
		}

		const errorStatus = execError.status;
		if (errorStatus !== null && errorStatus !== undefined) {
			console.error(`│  Exit Code: ${errorStatus}`);
		}

		console.error(`└─ App Path: ${appPath}`);
		console.error(`   Platform: ${process.platform} (${process.arch})`);

		// Provide help
		console.error(`\n💡 Troubleshooting:`);
		console.error(`   • Try opening manually: open "${appPath}"`);
		console.error(`   • Check if the app is quarantined: xattr -l "${appPath}"`);
		console.error(`   • Remove quarantine if needed: xattr -cr "${appPath}"`);

		// Suggest retry
		console.error(`\n🔄 To retry, run: ${ctx.retryCmd}`);
		console.error(`   Or clear cache first: rm -rf "${cacheRoot}"`);

		const exitCode = errorStatus !== undefined ? errorStatus : 1;
		process.exit(exitCode);
	}
}
