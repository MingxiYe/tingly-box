import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexContextChip } from './CodexContextChip';

const api = vi.hoisted(() => ({ getCodexCatalogWindows: vi.fn() }));
vi.mock('@/services/api', () => ({ api }));
// Keys with their values, so a note can be checked for the model and provider it names.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
    }),
}));

afterEach(() => {
    cleanup();
    api.getCodexCatalogWindows.mockReset();
});

const open = async (props: { window?: number; context1M?: boolean; auto?: unknown }) => {
    if (props.auto instanceof Error) api.getCodexCatalogWindows.mockRejectedValue(props.auto);
    else api.getCodexCatalogWindows.mockResolvedValue({ success: true, windows: { r1: props.auto } });
    render(
        <CodexContextChip
            window={props.window ?? 0}
            context1M={props.context1M ?? false}
            ruleUuid="r1"
            onChange={() => {}}
            buttonSx={{}}
            highlightedButtonSx={{}}
        />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ruleHeader\.context\.aria/ }));
    await vi.waitFor(() => expect(api.getCodexCatalogWindows).toHaveBeenCalled());
};

const autoCell = () => screen.getAllByRole('radio')[0];
const notes = () => screen.queryAllByText(/^ruleHeader\.(context\.(auto[A-Z1]|ignores1M|ceiling)|compact\.needsApply)/).map((el) => el.textContent ?? '');

describe('CodexContextChip', () => {
    it('names the catalog entry Auto comes from, its ceiling, and that 1M does not widen it', async () => {
        await open({
            context1M: true,
            auto: { window: 128_000, max: 128_000, source: 'catalog', provider: 'DeepSeek', model: 'deepseek-chat' },
        });
        expect(await screen.findByText(/ruleHeader\.context\.autoCatalog/)).toHaveTextContent('"model":"deepseek-chat","provider":"DeepSeek","value":"128K"');
        expect(screen.getByText('ruleHeader.context.ignores1M')).toBeInTheDocument();
        expect(screen.queryByText(/ruleHeader\.context\.ceiling/)).toBeNull();
        expect(within(autoCell()).getByText('128K')).toBeInTheDocument();
    });

    it('shows the ceiling Codex can be raised to; an own window has none above it', async () => {
        await open({ auto: { window: 272_000, max: 872_000, source: 'catalog', provider: 'ChatGPT', model: 'gpt-6-sol' } });
        expect(await screen.findByText(/ruleHeader\.context\.ceiling/)).toHaveTextContent('"max":"872K"');
        expect(screen.queryByText('ruleHeader.context.ignores1M')).toBeNull();
        cleanup();

        await open({ window: 128_000, auto: { window: 272_000, max: 872_000, source: 'catalog', provider: 'ChatGPT', model: 'gpt-6-sol' } });
        // The Auto cell shows the server's window, the header the rule's own.
        expect(await within(autoCell()).findByText('272K')).toBeInTheDocument();
        expect(screen.getByText('ruleHeader.context.title').parentElement).toHaveTextContent(/^ruleHeader\.context\.title128K$/);
        expect(screen.queryByText(/ruleHeader\.context\.ceiling/)).toBeNull();
    });

    it('says a Claude model on an Anthropic endpoint needs 1M for more than 200K', async () => {
        await open({
            auto: { window: 200_000, max: 200_000, source: 'anthropic', provider: 'Anthropic', model: 'claude-opus-4-8' },
        });
        expect(await screen.findByText(/ruleHeader\.context\.autoAnthropic/)).toHaveTextContent('"model":"claude-opus-4-8","provider":"Anthropic","value":"200K"');
    });

    it('names the upstream a model unknown to the catalog is on', async () => {
        await open({ auto: { window: 200_000, max: 200_000, source: 'default', provider: 'House', model: 'house-model' } });
        expect(await screen.findByText(/ruleHeader\.context\.autoUnknown/)).toHaveTextContent('"model":"house-model","provider":"House"');
    });

    it('falls back to the 1M flag when the server cannot be read', async () => {
        await open({ context1M: true, auto: new Error('offline') });
        expect(notes()).toEqual(['ruleHeader.context.auto1M', 'ruleHeader.compact.needsApply']);
        expect(screen.getAllByText('1M').length).toBeGreaterThan(0);
    });

    it('treats a malformed answer as unknown', async () => {
        await open({ auto: 272_000 });
        await vi.waitFor(() => expect(notes()).toEqual(['ruleHeader.context.autoDefault', 'ruleHeader.compact.needsApply']));
    });
});
