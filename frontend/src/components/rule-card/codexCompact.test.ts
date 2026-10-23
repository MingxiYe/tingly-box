import { describe, expect, it } from 'vitest';
import {
    CODEX_COMPACT,
    derivedWindow,
    formatWindow,
    isValidWindowOverride,
    lowZoneStart,
    parseWindowInput,
    planCodexCompact,
    resolveChipWindow,
} from './codexCompact';

const { window, window1M } = CODEX_COMPACT;

describe('planCodexCompact', () => {
    it('default 75% on 200K leaves 50K and is fine', () => {
        expect(planCodexCompact({ window, percent: 75 })).toEqual({
            applied: 75, line: 150_000, remain: 50_000, status: 'ok',
        });
    });

    it('82% of 200K is the limit: at it no warning, above it a warning', () => {
        expect(planCodexCompact({ window, percent: 82, effectivePercent: 95 }).status).toBe('ok');
        const plan = planCodexCompact({ window, percent: 85, effectivePercent: 95 });
        expect(plan.remain).toBe(30_000);
        expect(plan.status).toBe('low');
    });

    it('the same percent is fine on a 1M window', () => {
        expect(planCodexCompact({ window: window1M, percent: 82 }).status).toBe('ok');
    });

    it('is cut down to the usable window and says so', () => {
        const plan = planCodexCompact({ window: window1M, percent: 90 });
        expect(plan.applied).toBe(82);
        expect(plan.status).toBe('limited');
    });

    it('does not impose Codex\'s 90% ceiling, only the usable window', () => {
        const plan = planCodexCompact({ window: window1M, percent: 95, effectivePercent: 100 });
        expect(plan.applied).toBe(95);
        expect(plan.status).toBe('ok');
    });
});

describe('lowZoneStart', () => {
    it('starts at 82% on 200K and at 96.4% on 1M', () => {
        expect(lowZoneStart(window)).toBeCloseTo(82);
        expect(lowZoneStart(window1M)).toBeCloseTo(96.4);
    });
});

describe('Codex catalog window', () => {
    const deepseek = { window: 128_000, source: 'catalog' as const, provider: 'DeepSeek', model: 'deepseek-chat' };

    it('formats windows the way Codex users read them', () => {
        expect(formatWindow(200_000)).toBe('200K');
        expect(formatWindow(128_000)).toBe('128K');
        expect(formatWindow(1_000_000)).toBe('1M');
        expect(formatWindow(1_050_000)).toBe('1.05M');
        expect(formatWindow(8_192)).toBe('8.19K');
        expect(formatWindow(512)).toBe('512');
    });

    it('parses windows typed as digits or in the short form', () => {
        expect(parseWindowInput('128000')).toBe(128_000);
        expect(parseWindowInput(' 128,000 ')).toBe(128_000);
        expect(parseWindowInput('128K')).toBe(128_000);
        expect(parseWindowInput('128k')).toBe(128_000);
        expect(parseWindowInput('1.05M')).toBe(1_050_000);
        expect(parseWindowInput('0128000')).toBe(128_000);
        for (const bad of ['', 'abc', '1e6', '-5', '12KB', '1.2.3']) {
            expect(parseWindowInput(bad)).toBeNaN();
        }
    });

    it('accepts only whole windows inside the server bounds', () => {
        expect(isValidWindowOverride(128_000)).toBe(true);
        expect(isValidWindowOverride(CODEX_COMPACT.windowOverrideMin)).toBe(true);
        expect(isValidWindowOverride(CODEX_COMPACT.windowOverrideMax)).toBe(true);
        expect(isValidWindowOverride(CODEX_COMPACT.windowOverrideMin - 1)).toBe(false);
        expect(isValidWindowOverride(CODEX_COMPACT.windowOverrideMax + 1)).toBe(false);
        expect(isValidWindowOverride(0)).toBe(false);
        expect(isValidWindowOverride(Number.NaN)).toBe(false);
        expect(isValidWindowOverride(128_000.5)).toBe(false);
    });

    it('reads what the server derived, unwrapping an override', () => {
        expect(derivedWindow(deepseek)).toEqual(deepseek);
        expect(derivedWindow({ window: 64_000, source: 'override', derived: deepseek })).toEqual(deepseek);
        expect(derivedWindow({ window: 64_000, source: 'override' })).toBeNull();
        expect(derivedWindow(undefined)).toBeNull();
    });

    it('uses the rule override, then the derived window, then the flag guess', () => {
        expect(resolveChipWindow({ override: 64_000, detected: deepseek, context1M: false }))
            .toEqual({ window: 64_000, source: 'override' });
        // An override outside the bounds is ignored, as on the server.
        expect(resolveChipWindow({ override: 100, detected: deepseek, context1M: false })).toEqual(deepseek);
        // Server says override but the rule's override was just cleared: back to derived.
        expect(resolveChipWindow({ override: 0, detected: { window: 64_000, source: 'override', derived: deepseek }, context1M: false }))
            .toEqual(deepseek);
        // Not loaded yet.
        expect(resolveChipWindow({ override: 0, detected: null, context1M: false }).window).toBe(CODEX_COMPACT.window);
        expect(resolveChipWindow({ override: 0, detected: null, context1M: true }).window).toBe(CODEX_COMPACT.window1M);
    });

    it('a 128K window warns at the default 75%', () => {
        // 75% of 128K leaves 32K, under the 36K needed to compact safely.
        expect(planCodexCompact({ window: 128_000, percent: 75 }).status).toBe('low');
    });
});
