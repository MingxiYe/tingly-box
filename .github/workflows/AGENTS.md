# CI workflows: agent notes

**After any change under `.github/workflows/` or `.github/actions/`, lint it with actionlint before committing.** YAML parsing alone misses bad `needs`, wrong `with:` inputs, expression errors and shell mistakes.

```bash
go install github.com/rhysd/actionlint/cmd/actionlint@latest   # once, if `actionlint` is not on PATH
actionlint -color=false .github/workflows/*.yml
```

- Lint only `workflows/*.yml`; actionlint rejects `actions/*/action.yml` (it reads them as workflows).
- Known baseline warning, not yours: `docker-source.yml` has an empty `env: {}`. Anything else is.
- If a step has non-trivial shell, run it locally against a stub `gh` or real release assets before pushing; a regex written from memory (e.g. `file` output wording) is a common failure.

## Rules that bite

- A called workflow's job permissions can only narrow its caller's. Grant write scopes on the `uses:` job (see `release.yml`).
- `npm.yml` is bound to npm Trusted Publishing by its file name and the `production` environment. Do not rename it.
- Release is split: `release.yml` (entry) starts `release-cli.yml` and `release-gui.yml` in parallel; each has its own `verify-release-*.yml`. Keep GUI logic out of the CLI files and vice versa. Both create the release only through `actions/ensure-release`.
- The harness is compiled once in `harness-template.yml`'s `build` job; legs run the prebuilt binary, never `go run`.

Design notes: `.design/gui-packaging.md`, `.design/npm.md`, `.design/harness-matrix.md`.
