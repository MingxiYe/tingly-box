/** Fade elements up as they enter the viewport (skipped by CSS under reduced motion). */
export function mountReveal(selector: string): void {
  const targets = document.querySelectorAll<HTMLElement>(selector);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of targets) {
    el.classList.add('reveal');
    io.observe(el);
  }
}
