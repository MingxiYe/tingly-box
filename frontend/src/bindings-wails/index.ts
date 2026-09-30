// HostBridge for the Wails desktop window. Only this module talks to the
// Wails runtime and generated service bindings; see host/types.ts.
import type { HostBridge } from '@/host/types';
import { saveFileViaAnchor } from '@/host/saveFileViaAnchor';
// @ts-ignore - Wails bindings only available in GUI builds
import { TinglyService } from '../bindings/github.com/tingly-dev/tingly-box/gui/wails3/services';
// @ts-ignore - Wails runtime only available in GUI builds
import { Browser, Events } from '@wailsio/runtime';

// Gateway tray menus emit this with the target path (gui/wails3/systray.go).
const SHELL_NAVIGATE_EVENT = 'systray-navigate';

export const host: HostBridge = {
    kind: 'desktop',
    gatewayPort: () => TinglyService.GetPort(),
    shellAuthToken: async () => (await TinglyService.GetUserAuthToken()) || null,
    onShellNavigate: (handler) => {
        const off = Events.On(SHELL_NAVIGATE_EVENT, (event: any) => {
            const path = event?.data ?? event;
            if (typeof path === 'string') handler(path);
        });
        return () => off?.();
    },
    // A WebView has no tab strip to open `_blank` into; hand the URL to the
    // OS browser instead.
    openExternal: (url) => {
        void Browser.OpenURL(url);
    },
    saveFile: saveFileViaAnchor,
};

// The UI also has plain <a target="_blank"> links (docs, GitHub, provider
// consoles). Route those through openExternal too, once, here — rather than
// asking every link to know it might be running in a WebView.
document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
    if (!anchor || !/^https?:/i.test(anchor.href)) return;
    event.preventDefault();
    host.openExternal(anchor.href);
}, true);
