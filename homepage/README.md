# Homepage (GitHub Pages)

Static site, no build step. Deployed by `.github/workflows/homepage.yml`.

- `index.html` / `styles.css` — page and styles (light + dark via `prefers-color-scheme`)
- `hero.js` — hero canvas: a box grows from the Tingly tile into agent / IM / provider icons, then zooms out into a team of boxes (recursive, 3 levels)
- `main.js` — logo lists, tabs, copy buttons, and the sticky scroll-driven "How it works" stage
- `icons/` — vendored logos, see `icons/NOTICE.md`

Screenshots are reused from `docs/images/`, so preview through the build script:

```bash
scripts/build-homepage.sh _site
python3 -m http.server -d _site 8000   # http://localhost:8000
```
