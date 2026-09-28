/** Marks the nav link of the section currently in view with aria-current. */
export function mountNavHighlight(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.nav-links a[href^="#"]')];
  const sections = links
    .map((a) => document.querySelector<HTMLElement>(a.getAttribute('href') ?? ''))
    .filter((s): s is HTMLElement => !!s);
  const visible = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
    const current = sections.find((s) => visible.has(s));
    for (const a of links) {
      if (current && a.getAttribute('href') === `#${current.id}`) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => io.observe(s));
}
