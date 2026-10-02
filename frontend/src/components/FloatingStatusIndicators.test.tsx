import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingStatusIndicators } from './FloatingStatusIndicators';

const health = vi.hoisted(() => ({ isHealthy: true, showDisconnectDialog: vi.fn() }));
vi.mock('../contexts/HealthContext', () => ({ useHealth: () => health }));
vi.mock('../contexts/VersionContext', () => ({ useVersion: () => ({ hasUpdate: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => {
    cleanup();
    health.isHealthy = true;
    health.showDisconnectDialog.mockClear();
});

describe('connection status in development builds', () => {
    it('does not show a disconnected control for a healthy gateway', () => {
        const { container } = render(<FloatingStatusIndicators />);
        expect(container.querySelector('button')).toBeNull();
    });

    it('shows the disconnect dialog control when the gateway is unhealthy', () => {
        health.isHealthy = false;
        const { container } = render(<FloatingStatusIndicators />);
        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        fireEvent.click(button!);
        expect(health.showDisconnectDialog).toHaveBeenCalledOnce();
    });
});
