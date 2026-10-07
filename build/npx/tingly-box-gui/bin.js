#!/usr/bin/env node

import { createRequire } from "module";
import { launchGui } from "../shared/gui.js";
import { parseTransportVersion } from "../shared/transport.js";

// Default branch to use when not specified via transport version
// This will be replaced during the NPX build process
const BINARY_RELEASE_BRANCH = "latest";

const { version, remainingArgs } = parseTransportVersion();

launchGui({
	shimUrl: import.meta.url,
	// This shim's own npm version; the platform package must carry the same one.
	ownVersion: createRequire(import.meta.url)("./package.json").version,
	version,
	releaseTag: BINARY_RELEASE_BRANCH,
	retryCmd: `npx tingly-box-gui ${remainingArgs.join(" ")}`,
});
