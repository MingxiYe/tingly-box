// HostBridge is the one seam between the UI and whatever is hosting it:
// a plain browser tab (`tb open`, team deployments) or the Wails desktop
// window. Pages ask the bridge for a capability; they never branch on the
// build mode themselves. The implementation is picked at build time through
// the `@/bindings` alias (bindings-web vs bindings-wails), see
// .design/ui-redesign.md §4.2.
export interface HostBridge {
    kind: 'browser' | 'desktop';
    /** Port of the in-process gateway, or null when the page's own origin is the gateway. */
    gatewayPort(): Promise<number | null>;
    /** Auth token the desktop shell hands the UI when none is stored; null in a browser. */
    shellAuthToken(): Promise<string | null>;
    /** Subscribe to navigation requests from the shell (tray menu). Returns an unsubscribe. */
    onShellNavigate(handler: (path: string) => void): () => void;
    /** Open a URL outside the app, in the user's browser. */
    openExternal(url: string): void;
    /** Save a blob to the user's disk under the given file name. */
    saveFile(blob: Blob, fileName: string): void;
}
