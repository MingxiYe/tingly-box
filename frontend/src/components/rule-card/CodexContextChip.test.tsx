import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexCompactChip } from './CodexCompactChip';
import { CodexContextChip } from './CodexContextChip';
import { clearCodexAutoWindowCache } from './useCodexAutoWindow';

const api = vi.hoisted(() => ({ getCodexCatalogWindows: vi.fn(), getAppliedCodexConfig: vi.fn() }));
vi.mock('@/services/api', () => ({ api }));
// Keys with their values, so a note can be checked for the model and provider it names.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
    }),
}));

afterEach(() => {
    cleanup();
    clearCodexAutoWindowCache();
    api.getCodexCatalogWindows.mockReset();
    api.getAppliedCodexConfig.mockReset();
});

const DEEPSEEK = { window: 128_000, max: 128_000, source: 'catalog', provider: 'DeepSeek', model: 'deepseek-chat' };
const SOL = { window: 272_000, max: 872_000, source: 'catalog', provider: 'ChatGPT', model: 'gpt-6-sol' };

/** Serves `auto` as rule r1's answer: an object, a rejection, or a promise that never settles. */
const serve = (auto: unknown) => {
    if (auto instanceof Error) api.getCodexCatalogWindows.mockRejectedValue(auto);
    else if (auto === 'never') api.getCodexCatalogWindows.mockReturnValue(new Promise(() => {}));
    else api.getCodexCatalogWindows.mockResolvedValue({ success: true, windows: auto === undefined ? {} : { r1: auto } });
};

const chip = (props: { window?: number; context1M?: boolean; onChange?: (n: number) => void }) => (
    <CodexContextChip
        window={props.window ?? 0}
        context1M={props.context1M ?? false}
        ruleUuid="r1"
        onChange={props.onChange ?? (() => {})}
        buttonSx={{}}
        highlightedButtonSx={{}}
    />
);

// hidden: an open popover hides the rest of the page from assistive tech.
const chipButton = () => screen.getByRole('button', { name: /ruleHeader\.context\.aria/, hidden: true });

const open = async (props: Parameters<typeof chip>[0] & { auto?: unknown }) => {
    serve(props.auto);
    const view = render(chip(props));
    fireEvent.click(chipButton());
    // Let the read settle (a pending one stays pending).
    await act(async () => {});
    return view;
};

const notes = () => Array.from(document.querySelectorAll<HTMLElement>('[data-note]')).map((el) => [el.dataset.note, el.textContent ?? '']);
const noteIds = () => notes().map(([id]) => id);
const note = (id: string) => notes().find(([n]) => n === id)?.[1] ?? '';
const autoCell = () => screen.getAllByRole('radio')[0];
const header = () => screen.getByText('ruleHeader.context.title').parentElement!;

describe('CodexContextChip', () => {
    it('names the catalog entry Auto comes from, and that 1M does not widen it', async () => {
        await open({ context1M: true, auto: DEEPSEEK });
        expect(noteIds()).toEqual(['auto', '1m', 'apply']);
        expect(note('auto')).toBe('ruleHeader.context.autoCatalog {"model":"deepseek-chat","provider":"DeepSeek","value":"128K"}');
        expect(note('1m')).toContain('ruleHeader.context.ignores1M');
        expect(within(autoCell()).getByText('128K')).toBeInTheDocument();
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title128K$/);
        expect(chipButton()).toHaveAccessibleName(/ruleHeader\.context\.autoValue/);
    });

    it('offers the larger window the upstream accepts', async () => {
        const onChange = vi.fn();
        await open({ auto: SOL, onChange });
        expect(noteIds()).toEqual(['auto', 'max', 'apply']);
        expect(note('max')).toContain('ruleHeader.context.ceiling {"model":"gpt-6-sol","provider":"ChatGPT","value":"272K","max":"872K"}');
        fireEvent.click(screen.getByRole('button', { name: /ruleHeader\.context\.useCeiling/ }));
        expect(onChange).toHaveBeenCalledWith(872_000);
    });

    it('with its own window, only warns when it is above what the upstream accepts', async () => {
        await open({ window: 1_000_000, auto: SOL });
        expect(noteIds()).toEqual(['over', 'apply']);
        expect(note('over')).toContain('"value":"1M","max":"872K"');
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title1M$/);
        // The Auto cell still says what Auto would be.
        expect(within(autoCell()).getByText('272K')).toBeInTheDocument();
        cleanup();

        await open({ window: 128_000, auto: SOL });
        expect(noteIds()).toEqual(['apply']);
        cleanup();

        // An unknown model's 200K is a guess, not a limit to warn about.
        await open({ window: 400_000, auto: { window: 200_000, max: 200_000, source: 'default', provider: 'House', model: 'house-model' } });
        expect(noteIds()).toEqual(['apply']);
    });

    it('says a Claude model on an Anthropic endpoint needs 1M for more than 200K', async () => {
        const claude = { window: 200_000, max: 200_000, source: 'anthropic', provider: 'Anthropic', model: 'claude-opus-4-8' };
        await open({ auto: claude });
        expect(noteIds()).toEqual(['auto', 'apply']);
        expect(note('auto')).toBe('ruleHeader.context.autoAnthropic {"model":"claude-opus-4-8","provider":"Anthropic","value":"200K"}');
        cleanup();

        // Still 200K with 1M on: the request goes to the provider's OpenAI URL.
        await open({ context1M: true, auto: claude });
        expect(noteIds()).toEqual(['auto', 'apply']);
        expect(note('auto')).toContain('ruleHeader.context.autoAnthropicOpenAI');
    });

    it('names the upstream that gets 1M', async () => {
        await open({ context1M: true, auto: { window: 1_000_000, max: 1_000_000, source: '1m', provider: 'Anthropic', model: 'claude-opus-4-8' } });
        expect(noteIds()).toEqual(['auto', 'apply']);
        expect(note('auto')).toContain('ruleHeader.context.auto1M {"model":"claude-opus-4-8","provider":"Anthropic"');
    });

    it('marks the window of a model the catalog does not know as a guess', async () => {
        const house = { window: 1_000_000, max: 1_000_000, source: 'default', provider: 'House', model: 'house-model' };
        await open({ context1M: true, auto: house });
        expect(note('auto')).toContain('ruleHeader.context.autoGuess1M {"model":"house-model","provider":"House"');
        cleanup();

        await open({ auto: { ...house, window: 200_000, max: 200_000 } });
        expect(note('auto')).toContain('ruleHeader.context.autoUnknown');
        cleanup();

        await open({ auto: { window: 200_000, max: 200_000, source: 'default' } });
        expect(note('auto')).toBe('ruleHeader.context.autoDefault {"model":"","provider":"","value":"200K"}');
    });

    it('shows no number until the server answers', async () => {
        await open({ context1M: true, auto: 'never' });
        expect(noteIds()).toEqual(['auto', 'apply']);
        expect(note('auto')).toBe('ruleHeader.context.autoPending');
        expect(within(autoCell()).getByText('…')).toBeInTheDocument();
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title…$/);
        expect(chipButton()).toHaveAccessibleName('ruleHeader.context.aria {"value":"ruleHeader.context.auto"}');
    });

    it('says when the window could not be read', async () => {
        for (const auto of [new Error('offline'), undefined, 272_000, { window: '272000', max: 0, source: 'catalog' }, { window: 272_000, source: 'guess' }]) {
            await open({ auto });
            expect(note('auto'), String(auto)).toBe('ruleHeader.context.autoUnavailable {"model":"","provider":"","value":"200K"}');
            cleanup();
            clearCodexAutoWindowCache();
        }
    });

    it('forgets the answer when the 1M flag changes', async () => {
        const view = await open({ auto: { window: 200_000, max: 200_000, source: 'anthropic', provider: 'Anthropic', model: 'claude-opus-4-8' } });
        fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
        expect(chipButton()).toHaveAccessibleName(/autoValue.*200K/);

        view.rerender(chip({ context1M: true }));
        expect(chipButton()).toHaveAccessibleName('ruleHeader.context.aria {"value":"ruleHeader.context.auto"}');

        serve({ window: 1_000_000, max: 1_000_000, source: '1m', provider: 'Anthropic', model: 'claude-opus-4-8' });
        fireEvent.click(chipButton());
        await act(async () => {});
        expect(note('auto')).toContain('ruleHeader.context.auto1M');
    });

    it('keeps the last answer on reopen while it is read again', async () => {
        await open({ auto: DEEPSEEK });
        fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
        serve('never');
        fireEvent.click(chipButton());
        await act(async () => {});
        expect(api.getCodexCatalogWindows).toHaveBeenCalledTimes(2);
        expect(note('auto')).toContain('ruleHeader.context.autoCatalog');
    });
});

describe('CodexCompactChip', () => {
    const compact = (contextWindow = 0) => (
        <CodexCompactChip percent={0} contextWindow={contextWindow} context1M={false} ruleUuid="r1" onChange={() => {}} buttonSx={{}} highlightedButtonSx={{}} />
    );
    const openCompact = async (auto: unknown, contextWindow = 0) => {
        api.getAppliedCodexConfig.mockResolvedValue({ preferences: {} });
        serve(auto);
        render(compact(contextWindow));
        fireEvent.click(screen.getByRole('button', { name: /ruleHeader\.compact\.aria/ }));
        await act(async () => {});
    };
    const row = (label: string) => screen.getByText(label).parentElement!;

    it('previews against the Auto window', async () => {
        await openCompact(DEEPSEEK);
        expect(row('ruleHeader.compact.window')).toHaveTextContent('128K');
        expect(row('ruleHeader.compact.line')).toHaveTextContent('75% · 96,000 tokens');
    });

    it('shows only the percent until Auto is known, unless the rule has its own window', async () => {
        await openCompact('never');
        expect(row('ruleHeader.compact.window')).toHaveTextContent(/…$/);
        expect(row('ruleHeader.compact.line')).toHaveTextContent(/75%$/);
        cleanup();

        await openCompact('never', 256_000);
        expect(row('ruleHeader.compact.window')).toHaveTextContent('256K');
        expect(row('ruleHeader.compact.line')).toHaveTextContent('75% · 192,000 tokens');
    });
});
