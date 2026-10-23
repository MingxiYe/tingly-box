import React from 'react';
import { api } from '@/services/api';
import { fallbackCodexAutoWindow, type CodexAutoWindow, type CodexWindowSource } from './codexCompact';

const SOURCES: ReadonlySet<CodexWindowSource> = new Set(['catalog', 'anthropic', '1m', 'default']);

const parseAutoWindow = (raw: unknown): CodexAutoWindow | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const window = Number(r.window);
    const max = Number(r.max);
    const source = r.source as CodexAutoWindow['source'];
    if (!Number.isFinite(window) || window <= 0 || !SOURCES.has(source)) return undefined;
    return {
        window,
        max: Number.isFinite(max) && max > window ? max : window,
        source,
        provider: typeof r.provider === 'string' && r.provider ? r.provider : undefined,
        model: typeof r.model === 'string' && r.model ? r.model : undefined,
    };
};

/**
 * What a Codex rule's "Auto" window resolves to on the server: the window, its
 * ceiling, and the routed model and provider it comes from. Read when a
 * popover opens, so it follows service changes made since; until then (or if
 * it can't be read) it is the fallback for a model the catalog doesn't know.
 */
export function useCodexAutoWindow(ruleUuid: string | undefined, open: boolean, context1M: boolean): CodexAutoWindow {
    const [auto, setAuto] = React.useState<CodexAutoWindow | undefined>(undefined);
    React.useEffect(() => {
        if (!open || !ruleUuid) return;
        let cancelled = false;
        (async () => {
            try {
                const result = await api.getCodexCatalogWindows();
                if (!cancelled) setAuto(parseAutoWindow(result?.windows?.[ruleUuid]));
            } catch {
                // Keep what was last read; the fallback until then.
            }
        })();
        return () => { cancelled = true; };
    }, [open, ruleUuid]);
    return auto ?? fallbackCodexAutoWindow(context1M);
}
