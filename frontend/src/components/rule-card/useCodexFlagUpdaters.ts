import { useRef } from 'react';
import type { RuleFlags } from '@/components/RoutingGraphTypes';

/**
 * Savers for the Codex chip's two rule flags. The chip saves its percent after
 * a debounce from a closure of an earlier render, so each save merges into the
 * latest flags (including a save made a moment ago that hasn't re-rendered
 * yet) rather than the flags of the render that created the callback —
 * otherwise a percent save and a window save made close together undo each
 * other.
 */
export function useCodexFlagUpdaters(
    flags: RuleFlags | undefined,
    save: ((flags: RuleFlags) => void) | undefined,
) {
    const latest = useRef(flags);
    latest.current = flags;
    const update = (patch: Partial<RuleFlags>) => {
        const next = { ...latest.current, ...patch };
        latest.current = next;
        save?.(next);
    };
    return {
        setCompactPercent: (percent: number) => update({ codexCompactPercent: percent || undefined }),
        setContextWindow: (tokens: number) => update({ codexContextWindow: tokens || undefined }),
    };
}
