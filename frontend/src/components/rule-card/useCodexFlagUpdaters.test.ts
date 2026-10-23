import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCodexFlagUpdaters } from './useCodexFlagUpdaters';

describe('useCodexFlagUpdaters', () => {
    it('a debounced percent save after a window save keeps the window, and back', () => {
        const save = vi.fn();
        const { result } = renderHook(() => useCodexFlagUpdaters({ context1m: false }, save));
        // Both callbacks come from the same render, as in the chip's debounce.
        const { setCompactPercent, setContextWindow } = result.current;
        setContextWindow(64_000);
        setCompactPercent(80);
        expect(save).toHaveBeenLastCalledWith({ context1m: false, codexContextWindow: 64_000, codexCompactPercent: 80 });
        setContextWindow(0);
        expect(save).toHaveBeenLastCalledWith({ context1m: false, codexContextWindow: undefined, codexCompactPercent: 80 });
    });

    it('follows flags changed from elsewhere on the next render', () => {
        const save = vi.fn();
        const { result, rerender } = renderHook(({ flags }) => useCodexFlagUpdaters(flags, save), {
            initialProps: { flags: { codexCompactPercent: 60 } as Record<string, unknown> },
        });
        rerender({ flags: { codexCompactPercent: 60, skipUsage: true } });
        result.current.setContextWindow(100_000);
        expect(save).toHaveBeenLastCalledWith({ codexCompactPercent: 60, skipUsage: true, codexContextWindow: 100_000 });
    });
});
