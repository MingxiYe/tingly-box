import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CodexCompactChip from './CodexCompactChip';

// t() echoes the key and its params so the shown values are checkable.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key),
    }),
}));

const getAppliedCodexConfig = vi.fn();
vi.mock('@/services/api', () => ({
    api: { getAppliedCodexConfig: () => getAppliedCodexConfig() },
}));

const renderChip = (props: Partial<React.ComponentProps<typeof CodexCompactChip>> = {}) => {
    const onChange = vi.fn();
    const onWindowChange = vi.fn();
    render(
        <CodexCompactChip
            modelName="coder"
            percent={0}
            context1M={false}
            onChange={onChange}
            onWindowChange={onWindowChange}
            buttonSx={{}}
            highlightedButtonSx={{}}
            {...props}
        />,
    );
    return { onChange, onWindowChange };
};

const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: /ruleHeader\.compact\.aria/ }));
    await waitFor(() => expect(getAppliedCodexConfig).toHaveBeenCalled());
};

describe('CodexCompactChip window', () => {
    beforeEach(() => {
        getAppliedCodexConfig.mockReset();
        getAppliedCodexConfig.mockResolvedValue({
            preferences: {},
            contextWindows: {
                coder: { window: 128_000, source: 'catalog', provider: 'DeepSeek', model: 'deepseek-chat' },
            },
        });
    });

    it('shows the window derived from the routed model and where it comes from', async () => {
        renderChip();
        await open();
        expect(await screen.findByText('128K')).toBeInTheDocument();
        expect(screen.getByText(/windowSource\.catalog.*deepseek-chat.*DeepSeek/)).toBeInTheDocument();
        // Compacts at 75% of 128K, not of a flat 200K.
        expect(screen.getByText(/75% · 96,000 tokens/)).toBeInTheDocument();
    });

    it('saves a typed window and treats the derived value as "follow"', async () => {
        const { onWindowChange } = renderChip();
        await open();
        await screen.findByText('128K');

        fireEvent.click(screen.getByRole('button', { name: 'ruleHeader.compact.windowEdit' }));
        const input = screen.getByRole('textbox', { name: 'ruleHeader.compact.windowLabel' });
        fireEvent.change(input, { target: { value: '64000' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onWindowChange).toHaveBeenLastCalledWith(64_000);

        fireEvent.click(screen.getByRole('button', { name: 'ruleHeader.compact.windowEdit' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'ruleHeader.compact.windowLabel' }), { target: { value: '128000' } });
        fireEvent.click(screen.getByRole('button', { name: 'ruleHeader.compact.windowSave' }));
        expect(onWindowChange).toHaveBeenLastCalledWith(0);
    });

    it('refuses a window outside the bounds', async () => {
        const { onWindowChange } = renderChip();
        await open();
        await screen.findByText('128K');
        fireEvent.click(screen.getByRole('button', { name: 'ruleHeader.compact.windowEdit' }));
        const input = screen.getByRole('textbox', { name: 'ruleHeader.compact.windowLabel' });
        fireEvent.change(input, { target: { value: '500' } });
        expect(screen.getByText(/windowInvalid/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ruleHeader.compact.windowSave' })).toBeDisabled();
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onWindowChange).not.toHaveBeenCalled();
    });

    it('shows a pinned window and offers to go back to the derived one', async () => {
        getAppliedCodexConfig.mockResolvedValue({
            preferences: {},
            contextWindows: {
                coder: {
                    window: 64_000, source: 'override',
                    derived: { window: 128_000, source: 'catalog', provider: 'DeepSeek', model: 'deepseek-chat' },
                },
            },
        });
        const { onWindowChange } = renderChip({ windowOverride: 64_000 });
        await open();
        expect(await screen.findByText('64K')).toBeInTheDocument();
        expect(screen.getByText(/windowSource\.override/)).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /windowReset.*128K/ }));
        });
        expect(onWindowChange).toHaveBeenCalledWith(0);
    });

    it('falls back to the flag guess when the server has nothing for the model', async () => {
        getAppliedCodexConfig.mockResolvedValue({ preferences: {} });
        renderChip({ context1M: true });
        await open();
        expect(await screen.findByText('1M')).toBeInTheDocument();
    });

    it('shows nothing guessed while loading, and says so when the read fails', async () => {
        let reject: (e: Error) => void = () => {};
        getAppliedCodexConfig.mockReturnValue(new Promise((_, r) => { reject = r; }));
        renderChip();
        await open();
        expect(screen.getAllByText('…').length).toBeGreaterThanOrEqual(3);
        expect(screen.queryByText(/windowSource\.default/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ruleHeader.compact.windowEdit' })).not.toBeInTheDocument();
        await act(async () => { reject(new Error('offline')); });
        expect(await screen.findByText(/windowSource\.unavailable/)).toBeInTheDocument();
        expect(screen.getByText('200K')).toBeInTheDocument();
    });

    it('reads 128K / 1.05M / 128,000 as the user typed them', async () => {
        const { onWindowChange } = renderChip();
        await open();
        await screen.findByText('128K');
        for (const [typed, tokens] of [['64K', 64_000], ['1.05M', 1_050_000], ['96,000', 96_000]] as const) {
            fireEvent.click(screen.getByRole('button', { name: 'ruleHeader.compact.windowEdit' }));
            const input = screen.getByRole('textbox', { name: 'ruleHeader.compact.windowLabel' });
            fireEvent.change(input, { target: { value: typed } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onWindowChange).toHaveBeenLastCalledWith(tokens);
        }
    });

    it('Escape cancels the edit but keeps the popover open', async () => {
        const { onWindowChange } = renderChip();
        await open();
        await screen.findByText('128K');
        fireEvent.click(screen.getByRole('button', { name: 'ruleHeader.compact.windowEdit' }));
        const input = screen.getByRole('textbox', { name: 'ruleHeader.compact.windowLabel' });
        fireEvent.change(input, { target: { value: '64000' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('textbox', { name: 'ruleHeader.compact.windowLabel' })).not.toBeInTheDocument();
        expect(screen.getByText('128K')).toBeInTheDocument();
        expect(onWindowChange).not.toHaveBeenCalled();
    });

    it('shows a pinned window on the chip itself', () => {
        renderChip({ windowOverride: 64_000 });
        expect(screen.getByRole('button', { name: /ruleHeader\.compact\.aria.*compact\.auto · 64K/ })).toBeInTheDocument();
    });
});
