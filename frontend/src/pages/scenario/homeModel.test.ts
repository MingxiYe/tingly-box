import { describe, expect, it } from 'vitest';
import { buildAttentionItems, hasRoutableService, isAgentInUse, summarizeAgentActivity } from './homeModel';
import type { ProviderQuota } from '@/types/quota';

const NOW = new Date('2026-09-30T12:00:00Z').getTime();

const quota = (used_percent: number, label = '5h'): ProviderQuota => ({
    windows: [{ label, used: used_percent, limit: 100, used_percent, unknown: false, unlimited: false, kind: 'limit' }],
} as unknown as ProviderQuota);

describe('buildAttentionItems', () => {
    it('is empty when everything is fine', () => {
        expect(buildAttentionItems({
            healthy: true, hasUpdate: false, now: NOW,
            providers: [{ uuid: 'a', name: 'A', enabled: true }],
            quotas: { a: quota(40) },
        })).toEqual([]);
    });

    it('orders disconnect first and update last, and skips disabled providers', () => {
        const items = buildAttentionItems({
            healthy: false, hasUpdate: true, now: NOW,
            providers: [
                { uuid: 'a', name: 'Codex OAuth', enabled: true, oauth_detail: { expires_at: '2026-09-29T00:00:00Z' } },
                { uuid: 'b', name: 'Claude', enabled: true },
                { uuid: 'c', name: 'Off', enabled: false, oauth_detail: { expires_at: '2020-01-01T00:00:00Z' } },
            ],
            quotas: { b: quota(95, 'Weekly'), c: quota(100) },
        });
        expect(items.map(i => i.kind)).toEqual(['disconnected', 'oauthExpired', 'quotaLow', 'update']);
        expect(items[2]).toMatchObject({ providerName: 'Claude', windowLabel: 'Weekly', percentLeft: 5 });
    });

    it('does not flag a quota window without a figure', () => {
        const unknown = { windows: [{ label: 'x', used: 0, limit: 0, used_percent: 0, unknown: true, unlimited: false }] } as unknown as ProviderQuota;
        expect(buildAttentionItems({
            healthy: true, hasUpdate: false, now: NOW,
            providers: [{ uuid: 'a', enabled: true }], quotas: { a: unknown },
        })).toEqual([]);
    });
});

describe('summarizeAgentActivity', () => {
    it('folds profiles and teams into their base agent and keeps the newest request', () => {
        const out = summarizeAgentActivity(
            [
                { scenario: 'claude_code', timestamp: '2026-09-30T10:00:00Z', model: 'old' },
                { scenario: 'claude_code:p1', timestamp: '2026-09-30T11:00:00Z', model: 'deepseek-v4-pro', provider_name: 'DeepSeek', request_model: 'claude-sonnet-5' },
                { scenario: 'team:platform', timestamp: '2026-09-29T11:00:00Z', model: 'glm-5.1' },
            ],
            [
                { key: 'claude_code', request_count: 10, error_count: 1 },
                { key: 'claude_code:p1', request_count: 5, error_count: 0 },
                { scenario: 'codex', request_count: 3, error_count: 0 },
            ],
        );
        expect(out.claude_code).toEqual({
            lastAt: '2026-09-30T11:00:00Z', requestModel: 'claude-sonnet-5', model: 'deepseek-v4-pro',
            providerName: 'DeepSeek', requestCount: 15, errorCount: 1,
        });
        expect(out.team.model).toBe('glm-5.1');
        expect(out.codex).toEqual({ requestCount: 3, errorCount: 0 });
    });
});

describe('agent attention', () => {
    it('flags no provider, and only in-use agents that route nowhere or have stale config', () => {
        const items = buildAttentionItems({
            healthy: true, hasUpdate: false, now: NOW,
            providers: [], providersLoaded: true, quotas: {},
            agents: [
                { id: 'claude_code', inUse: true, routable: true, configState: 'outdated', configDiffCount: 2 },
                { id: 'openai', inUse: true, routable: false },
                { id: 'codex', inUse: false, routable: false, configState: 'outdated' },
            ],
        });
        expect(items).toEqual([
            { kind: 'noProvider' },
            { kind: 'configOutdated', agentId: 'claude_code', count: 2 },
            { kind: 'noService', agentId: 'openai' },
        ]);
    });

    it('does not count built-in virtual models as a connected AI', () => {
        expect(buildAttentionItems({
            healthy: true, hasUpdate: false, quotas: {}, providersLoaded: true,
            providers: [{ uuid: 'v', auth_type: 'vmodel' }],
        })).toEqual([{ kind: 'noProvider' }]);
    });

    it('does not claim nothing is connected before providers are read', () => {
        expect(buildAttentionItems({ healthy: true, hasUpdate: false, providers: [], quotas: {} })).toEqual([]);
    });
});

describe('hasRoutableService', () => {
    it('counts top-level and smart-routing services on active rules only', () => {
        expect(hasRoutableService([{ services: [] }])).toBe(false);
        expect(hasRoutableService([{ active: false, services: [{}] }])).toBe(false);
        expect(hasRoutableService([{ services: [], smart_routing: [{ services: [{}] }] }])).toBe(true);
        expect(hasRoutableService([{ services: [{}] }])).toBe(true);
    });
});

describe('isAgentInUse', () => {
    it('is in use with recent requests or a written client config', () => {
        expect(isAgentInUse(undefined)).toBe(false);
        expect(isAgentInUse({ requestCount: 0, errorCount: 0 }, 'not_applied')).toBe(false);
        expect(isAgentInUse({ requestCount: 3, errorCount: 0 })).toBe(true);
        expect(isAgentInUse(undefined, 'outdated')).toBe(true);
    });
});
