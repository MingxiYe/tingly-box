// Mirrors the Codex catalog rules in internal/config/apply_config_codex.go
// (codexEffectiveContextWindowPercent, codexDefaultAutoCompactTokenLimitPct,
// the 200K default / 1M windows, the codex_context_window override bounds).
// The server is the source of truth for what is written, including each
// model's derived window (GET /config/codex contextWindows); this only
// previews it while the popover is edited, so keep the numbers in sync.

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
    // Accepted range of a rule's own window (codex_context_window).
    windowOverrideMin: 8_000,
    windowOverrideMax: 10_000_000,
} as const;

/** Where a model's catalog window comes from (config.CodexWindowSource*). */
export type CodexWindowSource = 'override' | 'catalog' | 'context_1m' | 'default';

/** One entry of GET /config/codex `contextWindows`. */
export interface CodexDetectedWindow {
    window: number;
    source: CodexWindowSource;
    provider?: string;
    model?: string;
    /** Set when source is 'override': the window without the override. */
    derived?: CodexDetectedWindow;
}

/** What the server would derive for the model, ignoring any rule override. */
export function derivedWindow(entry: CodexDetectedWindow | null | undefined): CodexDetectedWindow | null {
    if (!entry) return null;
    if (entry.source === 'override') return entry.derived ?? null;
    return entry;
}

/** Whether `tokens` is a window the server accepts as a rule override. */
export function isValidWindowOverride(tokens: number): boolean {
    return Number.isInteger(tokens)
        && tokens >= CODEX_COMPACT.windowOverrideMin
        && tokens <= CODEX_COMPACT.windowOverrideMax;
}

/**
 * The window the popover works with: the rule's own override when valid, else
 * what the server derived for this model, else (not loaded yet) the old
 * flag-based guess.
 */
export function resolveChipWindow(opts: {
    override: number;
    detected: CodexDetectedWindow | null;
    context1M: boolean;
}): CodexDetectedWindow {
    if (isValidWindowOverride(opts.override)) {
        return { window: opts.override, source: 'override' };
    }
    const derived = derivedWindow(opts.detected);
    if (derived) return derived;
    return opts.context1M
        ? { window: CODEX_COMPACT.window1M, source: 'context_1m' }
        : { window: CODEX_COMPACT.window, source: 'default' };
}

/**
 * Reads a typed window: plain or grouped digits ("128000", "128,000") or the
 * short form the popover shows ("128K", "1.05M"). NaN when it isn't one.
 */
export function parseWindowInput(raw: string): number {
    const m = raw.trim().replace(/[,_\s]/g, '').match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
    if (!m) return Number.NaN;
    const scale = { '': 1, k: 1_000, m: 1_000_000 }[m[2].toLowerCase() as '' | 'k' | 'm'];
    return Math.round(Number(m[1]) * scale);
}

/** Short token count: 200000 → "200K", 1050000 → "1.05M", 8192 → "8.19K". */
export function formatWindow(tokens: number): string {
    const trim = (n: number) => String(Number(n.toFixed(2)));
    if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
    if (tokens >= 1_000) return `${trim(tokens / 1_000)}K`;
    return String(tokens);
}

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
