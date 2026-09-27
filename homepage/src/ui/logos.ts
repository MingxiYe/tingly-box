import type { Brand } from '../data/brands';

/** Fills a `<ul>` with brand chips; `labelled: false` renders icons only (names become alt text). */
export function renderLogos(id: string, brands: Brand[], labelled = true): void {
  const ul = document.getElementById(id);
  if (!ul) return;
  for (const b of brands) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = b.icon;
    img.alt = labelled ? '' : b.name;
    img.title = b.name;
    img.loading = 'lazy';
    li.append(img);
    if (labelled) li.append(b.name);
    ul.append(li);
  }
}
