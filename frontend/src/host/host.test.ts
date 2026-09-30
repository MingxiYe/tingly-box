import { afterEach, describe, expect, it, vi } from 'vitest';
import { host } from './index';

// Tests run against the browser bridge (vitest aliases @/bindings to
// bindings-web). These pin the browser behaviour the rest of the app relies
// on: same-origin API, no shell token, external links in a new tab.
describe('browser host bridge', () => {
    afterEach(() => vi.restoreAllMocks());

    it('uses the page origin as the gateway', async () => {
        expect(host.kind).toBe('browser');
        expect(await host.gatewayPort()).toBeNull();
        expect(await host.shellAuthToken()).toBeNull();
    });

    it('opens external links in a new tab without an opener', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        host.openExternal('https://github.com/tingly-dev/tingly-box');
        expect(open).toHaveBeenCalledWith('https://github.com/tingly-dev/tingly-box', '_blank', 'noopener,noreferrer');
    });

    it('never receives shell navigation', () => {
        const handler = vi.fn();
        const off = host.onShellNavigate(handler);
        off();
        expect(handler).not.toHaveBeenCalled();
    });
});
