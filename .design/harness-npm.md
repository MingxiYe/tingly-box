# Harness npm — rehearse the npm release from the current source

> For contributors who touch `build/npx/` (the shims, `shared/`, the platform
> packages) or the binaries those shims launch. Run it before the change goes up:
>
> ```
> build/npx/harness-npm.sh            # builds from source, starts the GUI (Linux: under Xvfb)
> build/npx/harness-npm.sh --keep     # keep the work dir (logs, registry storage)
> ```
>
> Related: [`npm.md`](./npm.md) (how the packages are built and published),
> [`npm.pencil.md`](./npm.pencil.md) (the `tb gui` flow).

## What it is for

`test-shim.sh <release-tag>` runs the shims against **an existing GitHub
release**: a good check of the shim logic, but the binaries are whatever was
released. When a released version is itself broken (it was: the GUI could not
start on a first launch), testing against it says nothing about the tree you are
changing. The harness rehearses the whole release path from the checkout instead:

```
 source ──go build──▶ binaries ──zip──▶ platform packages ──┐
 build/npx/{tingly-box,tingly-box-gui} ──as npm.yml──▶ shims ┴─ npm publish ─▶ local registry
                                                                              (Verdaccio)
   npm install -g tingly-box / tingly-box-gui · npm exec tingly-box · tb gui / tb app ◀─┘
                          └──▶ run, then assert what a user would see
```

Everything lives in one temp dir; the real `build/npx` tree is only read and
nothing is ever published to the real registry.

## Two rules that make it honest

1. **A virtual version.** Default `999.0.0`; the script refuses anything below
   `900.0.0`. A version that exists upstream would be tested against artifacts
   that are not this tree's. The binaries are stamped (`-X main.version=v999.0.0`),
   so the harness can assert that the process it launched is the one it just
   built, not a stale cache or a download.
2. **A local registry, real npm.** The user-level npm config points at Verdaccio
   and the publish order is CI's (platform packages, then shims), so
   `npm install -g`, `npm exec` and the shim's own `npm install` resolve as they
   would against npmjs, `optionalDependencies` pins included.

## What it checks

| Step | Assertion |
|---|---|
| Build | the CLI and the GUI build from source, stamped `v<version>` (Linux: GTK3 `go build`; macOS / Windows: `task darwin:package` / `task windows:build`, as `release-gui.yml`) |
| Packages | platform packages (`cli`, `gui`) and both shims (bundled as `npm.yml` does) publish |
| `npm install -g tingly-box` | the platform package lands next to the shim; the first run installs the binary from it with no download; `Version:` is the stamped one |
| `tb` / `npm exec` | the alias and the npx style run the same binary |
| `tb gui` for an unpublished app version | exits non-zero with "not published on npm"; no fallback |
| `tingly-box-gui`, `tb gui`, `tb app` | on a fresh HOME: the launcher returns, `~/.tingly-box` is created, the app **still serves 20 s later**, and reports the stamped version |

The 20 s check exists because a bug hid between "the launcher returned" and "the
app is up": the shim closed the app's stderr pipe and the app was killed by
SIGPIPE on its first log line. With the old launcher the harness fails exactly
those three checks. It does **not** reliably catch the other bug found on the way,
`ETXTBSY` (exec-ing a file that is still open for writing): that race is
probabilistic, so `test-shim.sh` section E runs 30 extract-then-exec rounds.

## Limits

- **Three hosts, one script.** It runs under bash on Linux, macOS and Windows (Git
  Bash) and builds the host's own platform package: linux-x64/arm64, darwin-arm64,
  win32-x64. macOS and Windows need go-task + wails3 and the generated frontend
  client (`task codegen`) for the GUI; without them the GUI steps are skipped, not
  failed. Linux needs Xvfb and D-Bus for the launch.
- **macOS starts the app with the real home directory** (`open -a` ignores the
  shell's env), and the launch clears `~/.tingly-box` and the GUI cache, so it only
  runs with `CI=true` or `HARNESS_ALLOW_REAL_HOME=1`. Use it on a throwaway runner.
- **The embedded UI is the checkout's**: the placeholder page unless the frontend
  was built into `internal/web/dist`. Any HTTP status counts as "serving".
- **Only the host's platform package** is built, so `optionalDependencies` hold one
  entry and the other platforms' pins are not exercised.
- **macOS / Windows paths were written without a real host to run them on**; the
  first dispatch of the workflow is their first real test. Windows is also where the
  shim's `npm.cmd` call (see [`npm.pencil.md`](./npm.pencil.md) §5) first runs for real.

## Running it in CI

`.github/workflows/harness-npm.yml` runs it on `ubuntu-24.04`, `macos-15` and
`windows-2025`, one job each (`fail-fast` off, so one OS failing does not hide the
others). It is **manual only**: the sole trigger is `workflow_dispatch` (Actions tab,
Run workflow, pick the branch), so nothing runs it on a push, a PR or a release.
Inputs: `platform` (`all` by default, or one OS), `version` (default `999.0.0`, must
stay >= 900.0.0) and `gui_launch` (turn off to check only install and the CLI, which
also skips the go-task / wails3 / frontend setup on macOS and Windows). Each job
installs its prerequisites, runs `npm ci` in `build/npx`, then the script; the checks
land in the job summary and, on failure, the harness logs are uploaded as
`harness-npm-logs-<platform>`.

GitHub lists a `workflow_dispatch` workflow only once its file is on the default
branch, so the first run is possible after it has been merged.
