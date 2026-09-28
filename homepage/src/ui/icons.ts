// Tabler icons (same family as the app) inlined into `<i data-icon="name">`.
import adjustments from '@tabler/icons/outline/adjustments-horizontal.svg?raw';
import arrowUpRight from '@tabler/icons/outline/arrow-up-right.svg?raw';
import book from '@tabler/icons/outline/book.svg?raw';
import github from '@tabler/icons/outline/brand-github.svg?raw';
import bug from '@tabler/icons/outline/bug.svg?raw';
import clock from '@tabler/icons/outline/clock.svg?raw';
import coin from '@tabler/icons/outline/coin.svg?raw';
import eyeOff from '@tabler/icons/outline/eye-off.svg?raw';
import folder from '@tabler/icons/outline/folder.svg?raw';
import lock from '@tabler/icons/outline/lock.svg?raw';
import users from '@tabler/icons/outline/users.svg?raw';
import worldSearch from '@tabler/icons/outline/world-search.svg?raw';
import worldWww from '@tabler/icons/outline/world-www.svg?raw';
import chartBar from '@tabler/icons/outline/chart-bar.svg?raw';
import click from '@tabler/icons/outline/click.svg?raw';
import mobileMessage from '@tabler/icons/outline/device-mobile-message.svg?raw';
import pullRequest from '@tabler/icons/outline/git-pull-request.svg?raw';
import key from '@tabler/icons/outline/key.svg?raw';
import messages from '@tabler/icons/outline/messages.svg?raw';
import photo from '@tabler/icons/outline/photo.svg?raw';
import plug from '@tabler/icons/outline/plug-connected.svg?raw';
import plus from '@tabler/icons/outline/plus.svg?raw';
import route from '@tabler/icons/outline/route.svg?raw';
import server from '@tabler/icons/outline/server.svg?raw';
import shield from '@tabler/icons/outline/shield-check.svg?raw';

const ICONS: Record<string, string> = {
  'adjustments-horizontal': adjustments,
  'arrow-up-right': arrowUpRight,
  book,
  'brand-github': github,
  bug,
  'chart-bar': chartBar,
  click,
  'device-mobile-message': mobileMessage,
  'git-pull-request': pullRequest,
  key,
  messages,
  photo,
  'plug-connected': plug,
  plus,
  route,
  server,
  'shield-check': shield,
  clock,
  coin,
  'eye-off': eyeOff,
  folder,
  lock,
  users,
  'world-search': worldSearch,
  'world-www': worldWww,
};

export function iconSvg(name: string): string {
  const svg = ICONS[name];
  if (!svg) throw new Error(`unknown icon: ${name}`);
  return svg;
}

export function mountIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    if (!el.firstElementChild) el.innerHTML = iconSvg(el.dataset.icon ?? '');
  }
}
