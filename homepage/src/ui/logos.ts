import type { Brand } from '../data/brands';
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

/** Writes list sizes into `[data-count="key"]`, so counts never drift from the data. */
export function renderCounts(counts: Record<string, number>): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
    const n = counts[el.dataset.count ?? ''];
    if (n !== undefined) el.textContent = String(n);
  }
}
