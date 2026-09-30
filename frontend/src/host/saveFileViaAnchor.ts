// Saving a blob with the anchor-click dance. Shared by both bridges: it is
// what a browser tab needs, and the desktop bridge uses it too until the
// WebViews it runs in are verified to honour `download` (if one doesn't,
// that bridge swaps in a native save dialog without touching call sites).
export const saveFileViaAnchor = (blob: Blob, fileName: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
