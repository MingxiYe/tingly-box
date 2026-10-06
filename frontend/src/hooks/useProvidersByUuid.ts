import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import type { IconSource } from '@/utils/providerIcon';

type ProviderIndex = Map<string, IconSource>;

// Dashboard rows only carry a provider uuid and name, so their logos need the
// provider list. Every table on the page asks for it; they share one fetch,
// reused for a short while so a provider added meanwhile still shows up.
const MAX_AGE_MS = 30_000;
let cached: { at: number; promise: Promise<ProviderIndex> } | null = null;

function loadProviderIndex(): Promise<ProviderIndex> {
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.promise;
    const promise = api.getProviders().then((result: any): ProviderIndex => {
        const list: any[] = Array.isArray(result?.data) ? result.data : [];
        return new Map(list.map((p) => [p.uuid, { api_base: p.api_base, oauth_detail: p.oauth_detail }]));
    }).catch((): ProviderIndex => {
        cached = null; // let the next ask retry
        return new Map();
    });
    cached = { at: Date.now(), promise };
    return promise;
}

/** Providers by uuid, for rows that only know the uuid. Empty until loaded. */
export function useProvidersByUuid(): ProviderIndex {
    const [index, setIndex] = useState<ProviderIndex>(() => new Map());
    useEffect(() => {
        let cancelled = false;
        void loadProviderIndex().then((next) => { if (!cancelled) setIndex(next); });
        return () => { cancelled = true; };
    }, []);
    return index;
}
