/**
 * `.copy` buttons copy, in order of preference: `data-copy` on a host element,
 * or the visible tab panel of the terminal window.
 * Comment spans (`.c`) are left out so pasted commands run as-is.
 */
function textOf(btn: HTMLElement): string | undefined {
  const host = btn.closest<HTMLElement>('[data-copy]');
  if (host?.dataset.copy) return host.dataset.copy;
  const scope = btn.closest('.term');
  const pre = scope?.querySelector<HTMLElement>('pre:not([hidden]) code');
  if (!pre) return undefined;
  const clone = pre.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.c').forEach((c) => c.remove());
  return clone.textContent
    ?.split('\n')
    .map((l) => l.trimEnd())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join('\n');
}

export function mountCopyButtons(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('.copy');
    if (!btn) return;
    const text = textOf(btn);
    if (!text || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text.trim()).then(() => {
      btn.dataset.copied = '';
      btn.textContent = 'Copied';
      setTimeout(() => {
        delete btn.dataset.copied;
        btn.textContent = 'Copy';
      }, 1600);
    });
  });
}
