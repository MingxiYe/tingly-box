#!/usr/bin/env bash
# Assemble the GitHub Pages site: homepage/ plus the screenshots it reuses from docs/.
# Usage: scripts/build-homepage.sh [out_dir]   (default: _site)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/_site}"

rm -rf "$out"
mkdir -p "$out/docs/images"
cp -R "$root/homepage/." "$out/"
cp "$root"/docs/images/*.png "$out/docs/images/"
cp "$root/docs/hero.png" "$out/docs/"
touch "$out/.nojekyll"

echo "homepage built at $out"
