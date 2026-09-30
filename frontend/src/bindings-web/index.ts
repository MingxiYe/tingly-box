// HostBridge for a plain browser tab (web builds, dev, mock, tests).
// The desktop counterpart is bindings-wails; see host/types.ts.
import type { HostBridge } from '@/host/types';
import { saveFileViaAnchor } from '@/host/saveFileViaAnchor';

export const host: HostBridge = {
    kind: 'browser',
    // The page is served by the gateway itself, so its origin is the API.
    gatewayPort: async () => null,
    shellAuthToken: async () => null,
    // No shell, no tray: nothing ever asks a browser tab to navigate.
    onShellNavigate: () => () => {},
    openExternal: (url) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    },
    saveFile: saveFileViaAnchor,
};
