import { useCallback, useEffect, useState } from 'react';

// A one-time tip (a CoachMark) that stays dismissed once closed, remembered
// in this browser's / window's localStorage only. Components showing
// different tips share one event, so a tip queued behind another one
// appears as soon as it closes.
const TIP_EVENT = 'one-time-tip-change';

const read = (key: string): boolean => {
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
};

export function useOneTimeTip(key: string) {
    const [dismissed, setDismissed] = useState(() => read(key));

    useEffect(() => {
        const sync = () => setDismissed(read(key));
        window.addEventListener(TIP_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(TIP_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, [key]);

    const dismiss = useCallback(() => {
        if (read(key)) return;
        try {
            localStorage.setItem(key, '1');
        } catch {
            // Storage blocked: it just closes for this page view.
        }
        setDismissed(true);
        window.dispatchEvent(new Event(TIP_EVENT));
    }, [key]);

    return { dismissed, dismiss };
}
