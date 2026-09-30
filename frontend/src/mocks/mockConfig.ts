// Mock-mode-only overrides for first-run UI (onboarding guides, tours…)
// that pop up unprompted. Left alone, they're exactly what a real new user
// should see — but a screenshot/E2E script hits a fresh browser context on
// every run, so without this every single run looks like day one and the
// guide dialog steals focus and blocks clicks.
//
// Default in mock mode: OFF. Automation gets a quiet app by default and
// never needs to know these dialogs exist. A test that specifically wants
// to exercise the first-run experience opts back in per-run via a query
// param — no code change, no shared state between runs.
//
//   ?mockOnboarding=on   force the guide to show, as if never seen
//   ?mockOnboarding=off  force it to stay hidden (the default — this param
//                        only needs to be spelled out when a page or a
//                        prior run left it in the "seen" state and a test
//                        wants to explicitly assert the off state)
//
// Adding another first-run flow later: give it its own localStorage key in
// utils/onboardingFlags.ts and seed/clear it the same way below — the query
// param namespace (`mockOnboarding`) is shared, so keep this a single flag
// for now rather than inventing per-flow param names ahead of need.
//
// Data profile — what the backend "has". The guide flag above only decides
// whether first-run dialogs pop; it says nothing about data, so a "new user"
// screenshot still showed 16 credentials and routed rules. The data profile
// covers the other half:
//
//   ?mockData=populated  the full demo data set (the default)
//   ?mockData=newcomer   a fresh install: no credentials, no quota, built-in
//                        rules with no services — for checking that every page
//                        lands sensibly before the user has added anything.
//                        Also turns the first-run guides on, unless
//                        ?mockOnboarding=off says otherwise.
//
// The profile sticks for the tab (sessionStorage), so in-app navigation and
// reloads that drop the query string stay in the chosen world; pass
// ?mockData=populated to switch back.
import { ROUTING_GUIDE_SEEN_KEY } from '@/utils/onboardingFlags';

export type MockOnboardingMode = 'on' | 'off';
export type MockDataProfile = 'populated' | 'newcomer';

const QUERY_PARAM = 'mockOnboarding';
const DATA_PARAM = 'mockData';
const DATA_STORAGE_KEY = 'tb.mockDataProfile';

export function resolveMockDataProfile(search: string = window.location.search): MockDataProfile {
    const fromQuery = new URLSearchParams(search).get(DATA_PARAM);
    if (fromQuery === 'newcomer' || fromQuery === 'populated') {
        try {
            sessionStorage.setItem(DATA_STORAGE_KEY, fromQuery);
        } catch {
            // Storage unavailable — the profile then lasts for this load only.
        }
        return fromQuery;
    }
    try {
        return sessionStorage.getItem(DATA_STORAGE_KEY) === 'newcomer' ? 'newcomer' : 'populated';
    } catch {
        return 'populated';
    }
}

export function resolveMockOnboardingMode(search: string): MockOnboardingMode {
    const explicit = new URLSearchParams(search).get(QUERY_PARAM);
    if (explicit === 'on' || explicit === 'off') return explicit;
    // A newcomer is exactly who the first-run guides are for.
    return resolveMockDataProfile(search) === 'newcomer' ? 'on' : 'off';
}

// Runs once at mock app boot, before React mounts — so by the time a guide's
// own auto-open effect checks localStorage, the answer is already the one
// this run asked for.
export function applyMockOnboardingOverride(search: string = window.location.search): void {
    const mode = resolveMockOnboardingMode(search);
    try {
        if (mode === 'on') {
            localStorage.removeItem(ROUTING_GUIDE_SEEN_KEY);
        } else {
            localStorage.setItem(ROUTING_GUIDE_SEEN_KEY, '1');
        }
    } catch {
        // Storage unavailable — nothing to override, the guide's own effect
        // already treats that case as "skip rather than risk re-opening".
    }
}
