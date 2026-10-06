import type { Provider } from '@/types/provider';

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
    provider: Pick<Provider, 'api_base' | 'oauth_detail'> | undefined,
    quotaProviderType?: string,
): string | undefined {
    if (quotaProviderType === 'tingly_box' || isTinglyBoxBase(provider?.api_base)) return 'tinglybox';
    if (quotaProviderType) return QUOTA_TYPE_ICON[quotaProviderType] ?? quotaProviderType;
    const issuer = provider?.oauth_detail?.provider_type || provider?.oauth_detail?.issuer;
    if (issuer) return QUOTA_TYPE_ICON[issuer] ?? issuer;
    return undefined;
}
