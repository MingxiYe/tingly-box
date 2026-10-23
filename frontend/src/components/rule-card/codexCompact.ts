// Mirrors the Codex catalog rules in internal/config/apply_config_codex.go
// (codexEffectiveContextWindowPercent,
// codexDefaultAutoCompactTokenLimitPct, the 200K / 1M windows). The server is
// the source of truth for what is written; this only previews it while a
// slider is dragged, so keep the numbers in sync.

export const CODEX_COMPACT = {
    min: 50,
    max: 100,
    defaultPercent: 75,
    defaultEffectivePercent: 82,
    window: 200_000,
    window1M: 1_000_000,
    // Below this many tokens left at compaction time there is too little room
    // for the summary request, system prompt, tool output and the reply. It is
    // the practical limit seen in use: 82% of a 200K window. Not a hard cap,
    // only where warnings start; larger windows reach it at a higher percent.
    minRemaining: 36_000,
} as const;

export type CodexCompactStatus = 'ok' | 'low' | 'limited';

export interface CodexCompactPlan {
    /** The percent that ends up in the catalog. */
    applied: number;
    /** Tokens at which Codex compacts. */
    line: number;
    /** Tokens still free when compaction fires. */
    remain: number;
    status: CodexCompactStatus;
}

/**
 * Resolves what a chosen percent turns into. `limited` = it exceeds the usable
 * window so it is cut down, `low` = it leaves too few tokens.
 */
export function planCodexCompact(opts: {
    window: number;
    percent: number;
    effectivePercent?: number;
}): CodexCompactPlan {
    const effective = opts.effectivePercent ?? CODEX_COMPACT.defaultEffectivePercent;
    const applied = Math.min(opts.percent, effective);
    const line = Math.floor((opts.window * applied) / 100);
    const remain = opts.window - line;
    let status: CodexCompactStatus = 'ok';
    if (opts.percent > applied) status = 'limited';
    else if (remain < CODEX_COMPACT.minRemaining) status = 'low';
    return { applied, line, remain, status };
}

/** Position (0–100) of `percent` on the slider track, which spans min–100. */
export function trackPosition(percent: number): number {
    const clamped = Math.min(Math.max(percent, CODEX_COMPACT.min), 100);
    return ((clamped - CODEX_COMPACT.min) / (100 - CODEX_COMPACT.min)) * 100;
}

/** Where the "too few tokens left" zone starts, or null when it lies beyond the track. */
export function lowZoneStart(window: number): number | null {
    const start = (1 - CODEX_COMPACT.minRemaining / window) * 100;
    return start < CODEX_COMPACT.max ? start : null;
}

export interface CodexCompactZones {
    /** Values in [from, to) leave too few tokens free; null when the range is empty. */
    low: { from: number; to: number } | null;
    /** Values at or above this are cut down to it (the usable window); null at 100. */
    cappedFrom: number | null;
}

/**
 * The stretches of the slider that need a warning: the "too few tokens left"
 * zone (only the part below the cap, since anything above is cut down to the
 * cap anyway) and the "capped by the usable window" zone.
 */
export function compactZones(window: number, effectivePercent: number): CodexCompactZones {
    const cap = Math.min(Math.max(effectivePercent, CODEX_COMPACT.min), 100);
    const lowStart = lowZoneStart(window);
    const lowFrom = lowStart === null ? null : Math.max(lowStart, CODEX_COMPACT.min);
    return {
        low: lowFrom !== null && lowFrom < cap ? { from: lowFrom, to: cap } : null,
        cappedFrom: cap < 100 ? cap : null,
    };
}

// Mirrors codexMinContextWindow / codexMaxContextWindow
// (internal/config/apply_config_codex.go).
export const CODEX_CONTEXT = {
    min: 8_000,
    max: 10_000_000,
    // Common real windows, for picking without typing.
    presets: [128_000, 200_000, 256_000, 400_000, 1_000_000],
} as const;

/**
 * Where a Codex rule's window comes from (CodexWindowSource* in
 * internal/config/apply_config_codex.go): the rule's own value, the routed
 * model's catalog entry, 200K for a Claude model on an Anthropic endpoint
 * without 1M, 1M with the 1M flag (that Claude model, or one the catalog
 * doesn't know), or 200K for an unknown model.
 */
export type CodexWindowSource = 'rule' | 'catalog' | 'anthropic' | '1m' | 'default';

/** A rule's Auto window as GET /config/codex/catalog-windows reports it. */
export interface CodexAutoWindow {
    window: number;
    /** The most Codex can be told to use (its model_context_window override). */
    max: number;
    source: Exclude<CodexWindowSource, 'rule'>;
    /** The routed upstream the window comes from (the smallest one reachable). */
    provider?: string;
    model?: string;
}

/**
 * Auto before the server has answered, or when it can't: what the server
 * gives a model it doesn't know (1M with the 1M flag, else 200K).
 */
export function fallbackCodexAutoWindow(context1M: boolean): CodexAutoWindow {
    const window = context1M ? CODEX_COMPACT.window1M : CODEX_COMPACT.window;
    return { window, max: window, source: context1M ? '1m' : 'default' };
}

export interface CodexResolvedWindow {
    window: number;
    max: number;
    source: CodexWindowSource;
}

/**
 * The window Codex is told about, its ceiling and where it comes from: the
 * rule's own value (also its ceiling), else Auto. Mirrors CodexContextWindowFor.
 */
export function resolveCodexWindowSource(manual: number, auto: CodexAutoWindow): CodexResolvedWindow {
    if (manual >= CODEX_CONTEXT.min && manual <= CODEX_CONTEXT.max) {
        return { window: manual, max: manual, source: 'rule' };
    }
    return { window: auto.window, max: Math.max(auto.window, auto.max), source: auto.source };
}

export function resolveCodexWindow(manual: number, auto: CodexAutoWindow): number {
    return resolveCodexWindowSource(manual, auto).window;
}

/** 200000 → "200K", 1000000 → "1M", 1500000 → "1.5M", 131072 → "131K". */
export function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(n);
}

/**
 * Reads what a person types for a window: "256k", "1m", "1.5M", "131072",
 * "200,000". Returns null when it is not a number in range.
 */
export function parseTokens(raw: string): number | null {
    const m = raw.trim().replace(/[,_\s]/g, '').match(/^(\d+(?:\.\d+)?)([km]?)$/i);
    if (!m) return null;
    const unit = m[2].toLowerCase();
    const n = Math.round(Number(m[1]) * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1));
    return n >= CODEX_CONTEXT.min && n <= CODEX_CONTEXT.max ? n : null;
}
