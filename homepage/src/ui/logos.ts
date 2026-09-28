import type { Brand, BrandGroup } from '../data/brands';
import { iconSvg } from './icons';

function logo(b: Brand, labelled: boolean): HTMLLIElement {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.src = b.icon;
  img.alt = labelled ? '' : b.name;
  img.title = b.name;
  img.loading = 'lazy';
  img.width = img.height = 28;
  li.append(img);
  if (labelled) {
    const name = document.createElement('span');
    name.textContent = b.name;
    li.append(name);
  }
  return li;
}

/**
 * Fills a `<ul>` with brand logos. `labelled: false` renders icons only (names
 * become alt text); `more` appends a closing "and anything compatible" tile.
 */
export function renderLogos(id: string, brands: Brand[], opts: { labelled?: boolean; more?: string } = {}): void {
  const ul = document.getElementById(id);
  if (!ul) return;
  const labelled = opts.labelled ?? true;
  ul.append(...brands.map((b) => logo(b, labelled)));
  if (opts.more) {
    const li = document.createElement('li');
    li.className = 'more';
    li.innerHTML = `<i aria-hidden="true">${iconSvg('plus')}</i>`;
    const text = document.createElement('span');
    text.textContent = opts.more;
    li.append(text);
    ul.append(li);
  }
}

/**
 * Renders groups into a container: one grid per group, separated by a divider
 * carrying a small label. `columns` is the widest column count the grid uses;
 * every group must fill whole rows at that width, ending on its "more" tile.
 */
export function renderLogoGroups(id: string, groups: BrandGroup[], columns: 2 | 4): void {
  const root = document.getElementById(id);
  if (!root) return;
  for (const [i, g] of groups.entries()) {
    if (import.meta.env.DEV && (g.brands.length + 1) % columns !== 0) {
      console.warn(`brand group "${g.label}" leaves a gap: ${g.brands.length} brands + more tile is not a multiple of ${columns}`);
    }
    const section = document.createElement('div');
    section.className = 'brand-sub';
    const label = document.createElement('p');
    label.className = 'sub-label';
    label.textContent = g.label;
    const ul = document.createElement('ul');
    ul.className = `brand-grid cols-${columns}`;
    ul.id = `${id}-${i}`;
    section.append(label, ul);
    root.append(section);
    renderLogos(ul.id, g.brands, { more: g.more });
  }
}
