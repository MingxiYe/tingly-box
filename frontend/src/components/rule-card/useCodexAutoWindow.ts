import React from 'react';
import { api } from '@/services/api';

/**
 * The context window the provider catalog records for a Codex rule's routed
 * model (0 = unknown), what the rule's "Auto" window resolves to. Read when a
 * popover opens, so it follows service changes made since.
 */
export function useCodexCatalogWindow(ruleUuid: string | undefined, open: boolean): number {
    const [window, setWindow] = React.useState(0);
    React.useEffect(() => {
        if (!open || !ruleUuid) return;
        let cancelled = false;
        (async () => {
            try {
                const result = await api.getCodexCatalogWindows();
                const value = Number(result?.windows?.[ruleUuid] ?? 0);
                if (!cancelled) setWindow(Number.isFinite(value) ? value : 0);
            } catch {
                // Unknown: Auto falls back to the 1M flag or 200K.
            }
        })();
        return () => { cancelled = true; };
    }, [open, ruleUuid]);
    return window;
}
