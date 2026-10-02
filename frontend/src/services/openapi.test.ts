import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlApi, resetControlApiClient } from './openapi';

vi.mock('@/utils/protocol', () => ({ getApiBaseUrl: async () => 'https://example.test' }));

describe('control API response handling', () => {
    beforeEach(() => {
        resetControlApiClient();
        localStorage.setItem('user_auth_token', 'synthetic-test-token');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it.each([502, 503])('returns a failure for an empty HTTP %s response', async (status) => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));

        const result = await controlApi((client, headers) => client.GET('/api/v1/config', { headers }));

        expect(result).toEqual({ success: false, error: 'Request failed' });
    });

    it('preserves the backend error message', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 })));

        const result = await controlApi((client, headers) => client.GET('/api/v1/config', { headers }));

        expect(result).toEqual({ success: false, error: 'Unavailable' });
    });

    it('preserves successful response data', async () => {
        const body = { success: true, data: { http_transport: { respect_env_proxy: false } } };
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));

        const result = await controlApi((client, headers) => client.GET('/api/v1/config', { headers }));

        expect(result).toEqual(body);
    });
});
