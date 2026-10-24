import React from 'react';
import { api } from '@/services/api';
import type { OpenAIModelsResponse } from '@/types/model';

/**
 * `known`: Codex's model list has been read for this model and 1M flag (its
 * window may still be 0 = unknown). `pending`: not read yet, or the 1M flag
 * changed since. `unavailable`: the read failed.
 */
export type CodexCatalogWindowStatus = 'known' | 'pending' | 'unavailable';

export interface CodexCatalogWindow {
    /** max_input_tokens: the window the rule's "Auto" tells Codex; 0 = unknown. */
    window: number;
    /** max_context_window: how far Codex may raise it; 0 = no further. */
    max: number;
    status: CodexCatalogWindowStatus;
}

// A token count from the list, 0 when absent or not a positive integer.
const tokens = (raw: unknown) => (typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0);

// Last answer per request model and 1M flag (the server's Auto depends on
// both), shared by the Context and Compact chips and kept across popover
// opens, so a reopen shows the last known value at once while it is read
// again.
const answers = new Map<string, { window: number; max: number }>();
const keyOf = (requestModel: string, context1M: boolean) => `${requestModel}\u0000${context1M ? '1m' : ''}`;

/**
 * Rules sharing a request model share one Codex catalog entry, which gets the
 * smallest window and the smallest ceiling (ResolveCodexContextWindows): so
 * does the chip. Entries without a window (unknown models) don't count.
 */
function smallestEntry(entries: { max_input_tokens?: unknown; max_context_window?: unknown }[]): { window: number; max: number } {
    let window = 0;
    let max = 0;
    for (const e of entries) {
        const w = tokens(e.max_input_tokens);
        if (!w) continue;
        const m = Math.max(w, tokens(e.max_context_window));
        window = window ? Math.min(window, w) : w;
        max = max ? Math.min(max, m) : m;
    }
    return { window, max: window ? Math.max(window, max) : 0 };
}

/** For tests. */
export function clearCodexCatalogWindowCache() {
    answers.clear();
}

/**
 * The window Codex's model list (/tingly/codex/v1/models, matched by request
 * model) gives a rule's model: max_input_tokens, what the rule's "Auto"
 * resolves to on the server (the routed model's input limit, opened by the 1M
 * flag where that widens it), and max_context_window, its ceiling. Codex's
 * context_window is this input budget, not the published context_window, which
 * for OpenAI models counts output too. Read when a popover opens, so it follows
 * service changes made since.
 */
export function useCodexCatalogWindow(requestModel: string | undefined, open: boolean, context1M: boolean): CodexCatalogWindow {
    const key = keyOf(requestModel ?? '', context1M);
    const [failed, setFailed] = React.useState<string | null>(null);
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        if (!open || !requestModel) return;
        let cancelled = false;
        (async () => {
            try {
                const list = await api.listScenarioModels('codex') as OpenAIModelsResponse;
                if (cancelled) return;
                answers.set(key, smallestEntry((list?.data ?? []).filter((m) => m.id === requestModel)));
                setFailed(null);
                rerender();
            } catch {
                // Keep the last answer if there is one.
                if (!cancelled) setFailed(key);
            }
        })();
        return () => { cancelled = true; };
    }, [open, requestModel, key]);

    // Without a request model there is no list entry to read: unknown.
    if (!requestModel) return { window: 0, max: 0, status: 'known' };
    const known = answers.get(key);
    if (known) return { ...known, status: 'known' };
    return { window: 0, max: 0, status: failed === key ? 'unavailable' : 'pending' };
}
