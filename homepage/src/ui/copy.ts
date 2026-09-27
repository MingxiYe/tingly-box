/** `.copy` buttons copy `data-copy` of their host, or the sibling `pre code` text. */
export function mountCopyButtons(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('.copy');
    if (!btn) return;
    const host = btn.closest<HTMLElement>('[data-copy]');
    const text = host?.dataset.copy ?? btn.parentElement?.querySelector('pre code')?.textContent;
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
