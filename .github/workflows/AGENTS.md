# CI workflows: agent notes

**After any change under `.github/workflows/` or `.github/actions/`, lint with actionlint before committing, and keep it clean.** YAML parsing alone misses bad `needs`, wrong `with:` inputs, expression errors and shell mistakes.

```bash
go install github.com/rhysd/actionlint/cmd/actionlint@latest   # once, if `actionlint` is not on PATH
actionlint -color=false .github/workflows/*.yml
```

Lint only `workflows/*.yml` (actionlint reads `actions/*/action.yml` as workflows and rejects them). For non-trivial shell in a step, run it locally against a stub `gh` or real release assets first; e.g. `file` output wording differs from what you expect.

## Rules that bite

- A called workflow's job permissions can only narrow its caller's: grant write scopes on the `uses:` job (see `release.yml`).
- `npm.yml` is bound to npm Trusted Publishing by its file name and the `production` environment. Do not rename it.
