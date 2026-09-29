import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSearchHistory } from './useSearchHistory';

describe('useSearchHistory', () => {
    beforeEach(() => localStorage.clear());

    it('remembers most-recent first, deduplicated case-insensitively', () => {
        const { result } = renderHook(() => useSearchHistory('p1'));
        act(() => result.current.remember('gpt'));
        act(() => result.current.remember('claude'));
        act(() => result.current.remember('GPT'));
        expect(result.current.history).toEqual(['GPT', 'claude']);
    });

    it('ignores blank terms and caps the list', () => {
        const { result } = renderHook(() => useSearchHistory('p1'));
        act(() => result.current.remember('   '));
        for (let i = 0; i < 10; i++) act(() => result.current.remember(`m${i}`));
        expect(result.current.history).toHaveLength(6);
        expect(result.current.history[0]).toBe('m9');
    });

    it('is scoped per provider and survives remount', () => {
        const a = renderHook(() => useSearchHistory('p1'));
        act(() => a.result.current.remember('opus'));
        const b = renderHook(() => useSearchHistory('p2'));
        expect(b.result.current.history).toEqual([]);
        const again = renderHook(() => useSearchHistory('p1'));
        expect(again.result.current.history).toEqual(['opus']);
        act(() => again.result.current.forget('opus'));
        expect(again.result.current.history).toEqual([]);
    });
});
