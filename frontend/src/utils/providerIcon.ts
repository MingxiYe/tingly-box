import { useCallback } from 'react';
import { getServiceProvidersSync, useProviderCatalogLoaded } from '@/services/serviceProviders';

/** The slice of a provider the icon lookup reads. */
export interface IconSource {
    api_base?: string;
    oauth_detail?: { provider_type?: string; issuer?: string };
}

// Quota provider_type values (ai/quota/types.go) whose name isn't already a
// ProviderIcon key.
const QUOTA_TYPE_ICON: Record<string, string> = {
    tingly_box: 'tinglybox',
    claude_code: 'claudecode',
    kimi_k2: 'kimi',
    kimi_code: 'kimi',
    zai: 'zhipu',
    glm: 'zhipu',
    minimaxi: 'minimax',
    vertex_ai: 'vertexai',
    gemini_cli: 'gemini',
    antigravity: 'google',
    qwen_code: 'qwen',
};

/**
 * Whether an API base is a Tingly-Box route (/tingly/<scenario>, possibly
 * behind a proxy prefix). Mirrors ai/quota's GatewayQuotaURL: the route shape,
 * not the host, identifies a Tingly-Box — an edge reaches its central box on
 * any host. Such a provider uses another Tingly-Box as its upstream.
 */
export function isTinglyBoxBase(apiBase?: string): boolean {
    return /\/tingly\/[^/]+/.test(apiBase ?? '');
}

/**
 * Picks the ProviderIcon identifier for a configured provider: a Tingly-Box
 * upstream first, then the quota fetcher's provider type, then the OAuth
 * issuer, then the API base's host. Undefined when nothing matches, so the
 * caller can fall back to ProviderIcon's neutral placeholder.
 */
export function providerIconId(
    provider: IconSource | undefined,
    quotaProviderType?: string,
): string | undefined {
    return providerIconIdFromHints(provider, quotaProviderType) ?? iconIdFromCatalog(provider);
}

function providerIconIdFromHints(
    provider: IconSource | undefined,
    quotaProviderType?: string,
): string | undefined {
    if (quotaProviderType === 'tingly_box' || isTinglyBoxBase(provider?.api_base)) return 'tinglybox';
    if (quotaProviderType) return QUOTA_TYPE_ICON[quotaProviderType] ?? quotaProviderType;
    const issuer = provider?.oauth_detail?.provider_type || provider?.oauth_detail?.issuer;
    if (issuer) return QUOTA_TYPE_ICON[issuer] ?? issuer;
    return undefined;
}

function hostOf(apiBase?: string): string {
    const base = (apiBase ?? '').trim();
    if (!base) return '';
    try {
        return new URL(base.includes('://') ? base : `http://${base}`).hostname.toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Last resort for plain API-key providers, which carry no quota type: match the
 * API base's host against the catalog's canonical_domain and base URLs
 * (a host or a dot-separated suffix of it). Several templates can share one host — OAuth
 * products such as Claude Code sit on api.anthropic.com beside the API itself —
 * so OAuth templates are skipped and the longest matching domain wins.
 */
function iconIdFromCatalog(provider: IconSource | undefined): string | undefined {
    const host = hostOf(provider?.api_base);
    if (!host) return undefined;
    let best: { domain: string; icon: string } | undefined;
    for (const template of Object.values(getServiceProvidersSync())) {
        if (!template.icon || template.auth_type === 'oauth') continue;
        const domains = [template.canonical_domain, hostOf(template.base_url_openai), hostOf(template.base_url_anthropic)];
        for (const raw of domains) {
            const domain = raw?.toLowerCase();
            if (!domain || (host !== domain && !host.endsWith(`.${domain}`))) continue;
            if (!best || domain.length > best.domain.length) best = { domain, icon: template.icon };
        }
    }
    return best?.icon;
}

/**
 * providerIconId as a hook: re-renders once the provider catalog has loaded, so
 * a list rendered before that resolves picks up its icons afterwards.
 */
export function useProviderIconId() {
    useProviderCatalogLoaded();
    return useCallback(providerIconId, []);
}
