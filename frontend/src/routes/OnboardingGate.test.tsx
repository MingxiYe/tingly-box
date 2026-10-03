import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/services/api';
import OnboardingGate from './OnboardingGate';

vi.mock('@/services/api', () => ({ api: { getProviders: vi.fn() } }));

afterEach(() => {
    cleanup();
    vi.resetAllMocks();
});

const renderLanding = () => render(
    <MemoryRouter initialEntries={['/']}>
        <Routes>
            <Route path="/" element={<OnboardingGate />} />
            <Route path="/help" element={<div>Connect your first provider</div>} />
            <Route path="/agent" element={<div>Agent setup</div>} />
        </Routes>
    </MemoryRouter>,
);

describe('first-run landing', () => {
    it.each([{ providers: [] }, { providers: [{ auth_type: 'vmodel', enabled: true }] }])(
        'opens Help when no credential providers exist: $providers', async ({ providers }) => {
            vi.mocked(api.getProviders).mockResolvedValue({ success: true, data: providers });
            renderLanding();
            expect(await screen.findByText('Connect your first provider')).toBeVisible();
        },
    );

    it('keeps configured credential providers on the agent landing, even when disabled', async () => {
        vi.mocked(api.getProviders).mockResolvedValue({ success: true, data: [
            { auth_type: 'vmodel', enabled: true },
            { auth_type: 'oauth', enabled: false },
        ] });
        renderLanding();
        expect(await screen.findByText('Agent setup')).toBeVisible();
    });

    it('does not mistake an API failure for a fresh installation', async () => {
        vi.mocked(api.getProviders).mockResolvedValue({ success: false, error: 'Unavailable' });
        renderLanding();
        expect(await screen.findByText('Agent setup')).toBeVisible();
    });
});
