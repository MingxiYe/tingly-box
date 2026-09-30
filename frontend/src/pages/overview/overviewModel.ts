// Pure data shaping for the Dashboard Overview (StatusOverviewPage), kept
// apart from the page so it can be tested without rendering.
import { quotaRemainingPercent, tightestWindow, type ProviderQuota } from '@/types/quota';

/** Below this share of a quota window left, a provider needs attention. */
export const LOW_QUOTA_PERCENT = 20;

export interface ProviderLike {
    uuid: string;
    name?: string;
    enabled?: boolean;
    auth_type?: string;
    oauth_detail?: { expires_at?: string } | null;
}

export type AttentionItem =
    | { kind: 'disconnected' }
    | { kind: 'update' }
    | { kind: 'quotaLow'; providerUuid: string; providerName: string; windowLabel: string; percentLeft: number }
    | { kind: 'oauthExpired'; providerUuid: string; providerName: string };

// What needs the operator now, most severe first. Each kind maps to exactly
// one next action on the page (ux-principles #11).
export function buildAttentionItems(input: {
    healthy: boolean;
    hasUpdate: boolean;
    providers: ProviderLike[];
    quotas: Record<string, ProviderQuota | undefined>;
    now?: number;
}): AttentionItem[] {
    const now = input.now ?? Date.now();
    const items: AttentionItem[] = [];
    if (!input.healthy) items.push({ kind: 'disconnected' });

    for (const p of input.providers) {
        if (p.enabled === false) continue;
        const name = p.name || p.uuid;
        const expiresAt = p.oauth_detail?.expires_at;
        if (expiresAt && new Date(expiresAt).getTime() < now) {
            items.push({ kind: 'oauthExpired', providerUuid: p.uuid, providerName: name });
        }
        const window = tightestWindow(input.quotas[p.uuid]);
        if (window) {
            const percentLeft = quotaRemainingPercent(window);
            if (percentLeft < LOW_QUOTA_PERCENT) {
                items.push({
                    kind: 'quotaLow',
                    providerUuid: p.uuid,
                    providerName: name,
                    windowLabel: window.label || '',
                    percentLeft: Math.round(percentLeft),
                });
            }
        }
    }

    if (input.hasUpdate) items.push({ kind: 'update' });
    return items;
}

export interface UsageRecordLike {
    scenario?: string;
    timestamp: string;
    model?: string;
    provider_name?: string;
    request_model?: string;
    status?: string;
}

export interface ScenarioStatLike {
    key?: string;
    scenario?: string;
    request_count?: number;
    error_count?: number;
}

export interface AgentActivity {
    lastAt?: string;
    requestModel?: string;
    model?: string;
    providerName?: string;
    requestCount: number;
    errorCount: number;
}

// Usage is recorded per scenario id, which for a Claude Code profile or a
// Team carries a suffix ("claude_code:p1", "team:platform"); the overview
// lists base agents, so fold those into their base id.
export const baseScenarioId = (scenario: string): string => scenario.split(':')[0];

// Per base agent: the most recent request (records arrive newest first, but
// don't rely on it) and the request/error totals from the scenario stats.
export function summarizeAgentActivity(
    records: UsageRecordLike[],
    stats: ScenarioStatLike[],
): Record<string, AgentActivity> {
    const out: Record<string, AgentActivity> = {};
    const entry = (id: string) => (out[id] ??= { requestCount: 0, errorCount: 0 });

    for (const s of stats) {
        const scenario = s.scenario || s.key;
        if (!scenario) continue;
        const e = entry(baseScenarioId(scenario));
        e.requestCount += s.request_count ?? 0;
        e.errorCount += s.error_count ?? 0;
    }

    for (const r of records) {
        if (!r.scenario) continue;
        const e = entry(baseScenarioId(r.scenario));
        if (e.lastAt && new Date(e.lastAt).getTime() >= new Date(r.timestamp).getTime()) continue;
        e.lastAt = r.timestamp;
        e.requestModel = r.request_model || undefined;
        e.model = r.model || undefined;
        e.providerName = r.provider_name || undefined;
    }
    return out;
}
