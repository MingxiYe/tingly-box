/** Accessible tabs: `[data-tabs]` containing `[role=tab]` buttons with aria-controls. */
export function mountTabs(root: ParentNode = document): void {
  for (const group of root.querySelectorAll<HTMLElement>('[data-tabs]')) {
    const tabs = [...group.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const select = (tab: HTMLButtonElement, focus = false): void => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
        if (panel) panel.hidden = !on;
      }
      if (focus) tab.focus();
      // tab strips can scroll sideways on narrow screens
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) {
          e.preventDefault();
          select(tabs[(i + d + tabs.length) % tabs.length], true);
        }
      });
    });
  }
}
