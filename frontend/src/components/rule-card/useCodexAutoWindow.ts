import React from 'react';
import { api } from '@/services/api';
import { CODEX_CONTEXT, fallbackCodexAutoWindow, type CodexAutoWindow, type CodexWindowSource } from './codexCompact';

const SOURCES: ReadonlySet<CodexWindowSource> = new Set(['catalog', 'anthropic', '1m', 'default']);

export const parseCodexAutoWindow = (raw: unknown): CodexAutoWindow | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const { window, max, source } = r;
    if (typeof window !== 'number' || !Number.isInteger(window) || window < CODEX_CONTEXT.min) return undefined;
    if (!SOURCES.has(source as CodexWindowSource)) return undefined;
    return {
        window,
        max: typeof max === 'number' && max > window ? max : window,
        source: source as CodexAutoWindow['source'],
        provider: typeof r.provider === 'string' && r.provider ? r.provider : undefined,
        model: typeof r.model === 'string' && r.model ? r.model : undefined,
    };
};

/**
 * `known`: what the server last said for this rule. `pending`: not read yet
 * (or the 1M flag changed since), `unavailable`: the read failed or had no
 * answer for the rule; `auto` is then the unknown-model fallback.
 */
export type CodexAutoWindowStatus = 'known' | 'pending' | 'unavailable';

// Last answer per rule and 1M flag, shared by the Context and Compact chips and
// kept across popover opens, so a reopen shows the last known value at once
// while it is read again.
const answers = new Map<string, CodexAutoWindow>();
const keyOf = (ruleUuid: string | undefined, context1M: boolean) => `${ruleUuid ?? ''}\u0000${context1M ? '1m' : ''}`;

/** For tests. */
export function clearCodexAutoWindowCache() {
    answers.clear();
}

/**
 * What a Codex rule's "Auto" window resolves to on the server: the window, its
 * ceiling, and the routed model and provider it comes from. Read each time a
 * popover opens, so it follows service changes made since.
 */
export function useCodexAutoWindow(
    ruleUuid: string | undefined,
    open: boolean,
    context1M: boolean,
): { auto: CodexAutoWindow; status: CodexAutoWindowStatus } {
    const key = keyOf(ruleUuid, context1M);
    const [failed, setFailed] = React.useState<string | null>(null);
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        if (!open || !ruleUuid) return;
        let cancelled = false;
        (async () => {
            try {
                const result = await api.getCodexCatalogWindows();
                if (cancelled) return;
                const auto = parseCodexAutoWindow(result?.windows?.[ruleUuid]);
                if (auto) answers.set(key, auto);
                else answers.delete(key);
                setFailed(auto ? null : key);
                rerender();
            } catch {
                // Keep the last answer if there is one.
                if (!cancelled) setFailed(key);
            }
        })();
        return () => { cancelled = true; };
    }, [open, ruleUuid, key]);

    const known = answers.get(key);
    if (known) return { auto: known, status: 'known' };
    return { auto: fallbackCodexAutoWindow(context1M), status: failed === key ? 'unavailable' : 'pending' };
}
