// Saving a blob to the user's disk, and the naming that goes with it.
//
// Deliberately not part of any one feature. The actual save is the host
// bridge's (a browser tab and the desktop WebView may need different
// mechanisms); this module owns the naming around it.
//
// `downloadImage` below is the one export that isn't generic: it composes the
// save above with `fetchBlob`/`extensionForMime` from
// `@tingly/vision`, which own those two (image-specific) concerns.

import { extensionForMime, fetchBlob } from '@tingly/vision';
import { host } from '@/host';

export const downloadBlob = (blob: Blob, fileName: string): void => host.saveFile(blob, fileName);

export const downloadText = (content: string, fileName: string, mimeType: string): void =>
    downloadBlob(new Blob([content], { type: mimeType }), fileName);

/** Filename-safe stem derived from free text, so downloads are recognisable. */
export const slugify = (text: string, maxLength = 32): string => {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9一-龥]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength)
        .replace(/-+$/g, '');
    return slug || 'image';
};

/** Fetches an image and saves it under `<stem>.<its own extension>`. */
export const downloadImage = async (src: string, stem: string): Promise<void> => {
    const blob = await fetchBlob(src);
    downloadBlob(blob, `${stem}.${extensionForMime(blob.type)}`);
};
