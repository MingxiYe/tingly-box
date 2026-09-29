import { useCallback, useState } from 'react';

const SEARCH_HISTORY_STORAGE_KEY = 'tingly_model_search_history';
const MAX_SEARCH_HISTORY = 6;

type SearchHistoryData = { [scopeKey: string]: string[] };

function readAll(): SearchHistoryData {
    try {
        const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeAll(data: SearchHistoryData) {
    try {
        localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(data));
    } catch {
        // storage full/blocked — history is a convenience, never fatal
    }
}

// useSearchHistory: device-local memory of the search terms a user typed to
// find a model, per scope (a provider uuid). Provider model lists run to
// hundreds of entries, so re-finding "the model I found last time" by
// retyping is the friction this removes. Most-recent first, deduplicated
// case-insensitively, capped at MAX_SEARCH_HISTORY.
export function useSearchHistory(scopeKey: string) {
    const [all, setAll] = useState<SearchHistoryData>(readAll);
    const history = all[scopeKey] ?? [];

    const remember = useCallback((term: string) => {
        const trimmed = term.trim();
        if (!trimmed) return;
        const current = readAll();
        const rest = (current[scopeKey] ?? []).filter(t => t.toLowerCase() !== trimmed.toLowerCase());
        const next = { ...current, [scopeKey]: [trimmed, ...rest].slice(0, MAX_SEARCH_HISTORY) };
        writeAll(next);
        setAll(next);
    }, [scopeKey]);

    const forget = useCallback((term: string) => {
        const current = readAll();
        const next = { ...current, [scopeKey]: (current[scopeKey] ?? []).filter(t => t !== term) };
        writeAll(next);
        setAll(next);
    }, [scopeKey]);

    const clear = useCallback(() => {
        const current = readAll();
        delete current[scopeKey];
        writeAll(current);
        setAll(current);
    }, [scopeKey]);

    return { history, remember, forget, clear };
}
