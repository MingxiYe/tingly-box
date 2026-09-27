# Homepage (GitHub Pages)

Vite + TypeScript, no framework. `.github/workflows/homepage.yml` builds it and
deploys `dist/` to GitHub Pages on pushes to `main` (PRs only build).

```bash
task homepage          # dev server with hot reload   (or: cd homepage && pnpm dev)
task homepage:build    # production build → homepage/dist
```

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Page content and section markup |
| `src/styles.css` | Styles and colour tokens (light + dark); `--hero-*` tokens also drive the canvas |
| `src/data/brands.ts` | Agents, providers and IM channels shown on the page — **edit this to add or hide a brand** |
| `src/hero/` | Hero canvas: icons assemble into the Tingly Box "T" (`shape.ts` is the T as ASCII art), fold back into the icon, repeat |
| `src/flow/stage.ts` | Sticky, scroll-driven "How it works" stage |
| `src/ui/` | Tabs, copy buttons, logo lists, reveal-on-scroll |

- Provider / agent logos come from `@lobehub/icons-static-svg` (same package as the app); IM and editor icons are imported from `frontend/src/assets/icons` via the `@app-assets` alias.
- Screenshots are referenced from `raw.githubusercontent.com/.../main/docs/images/`, so updating `docs/images` updates the site without a rebuild.
- Only list integrations that ship. Slack and Discord are intentionally left out until they do.
