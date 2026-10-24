import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexCompactChip } from './CodexCompactChip';
import { CodexContextChip } from './CodexContextChip';
import { clearCodexCatalogWindowCache } from './useCodexCatalogWindow';

const api = vi.hoisted(() => ({ listScenarioModels: vi.fn(), getAppliedCodexConfig: vi.fn() }));
vi.mock('@/services/api', () => ({ api }));
// Keys with their values, so a note can be checked for the numbers it gives.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
    }),
}));

afterEach(() => {
    cleanup();
    clearCodexCatalogWindowCache();
    api.listScenarioModels.mockReset();
    api.getAppliedCodexConfig.mockReset();
});

const DEEPSEEK = { max_input_tokens: 128_000 };
const SOL = { max_input_tokens: 272_000, max_context_window: 872_000 };

/**
 * Serves `entry` as the "luna" model of Codex's model list: its fields (an
 * array for several rules sharing the name), no entry (undefined), a
 * rejection, or a promise that never settles.
 */
const serve = (entry: unknown) => {
    if (entry instanceof Error) api.listScenarioModels.mockRejectedValue(entry);
    else if (entry === 'never') api.listScenarioModels.mockReturnValue(new Promise(() => {}));
    else api.listScenarioModels.mockResolvedValue({
        object: 'list',
        data: [
            { id: 'other', object: 'model', created: 0, owned_by: 'tingly-box', max_input_tokens: 64_000 },
            ...(entry === undefined ? [] : [entry].flat().map((e) => ({ id: 'luna', object: 'model', created: 0, owned_by: 'tingly-box', ...(e as object) }))),
        ],
    });
};

const chip = (props: { window?: number; context1M?: boolean; onChange?: (n: number) => void }) => (
    <CodexContextChip
        window={props.window ?? 0}
        context1M={props.context1M ?? false}
        requestModel="luna"
        onChange={props.onChange ?? (() => {})}
        buttonSx={{}}
        highlightedButtonSx={{}}
    />
);

// hidden: an open popover hides the rest of the page from assistive tech.
const chipButton = () => screen.getByRole('button', { name: /ruleHeader\.context\.aria/, hidden: true });

const open = async (props: Parameters<typeof chip>[0] & { entry?: unknown }) => {
    serve(props.entry);
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
    it('shows the window Codex\'s model list gives the request model', async () => {
        await open({ entry: DEEPSEEK });
        expect(api.listScenarioModels).toHaveBeenCalledWith('codex');
        expect(noteIds()).toEqual(['auto', 'apply']);
        expect(note('auto')).toBe('ruleHeader.context.autoCatalog {"value":"128K"}');
        expect(within(autoCell()).getByText('128K')).toBeInTheDocument();
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title128K$/);
        expect(chipButton()).toHaveAccessibleName(/ruleHeader\.context\.autoValue.*128K/);
    });

    it('with 1M on, a known window is what the server opened, not 1M', async () => {
        await open({ context1M: true, entry: DEEPSEEK });
        expect(noteIds()).toEqual(['auto', 'apply']);
        expect(note('auto')).toBe('ruleHeader.context.auto1M {"value":"128K"}');
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title128K$/);
    });

    it('says the 1M flag opens the larger window the model has', async () => {
        await open({ entry: SOL });
        expect(noteIds()).toEqual(['auto', 'max', 'apply']);
        expect(note('max')).toBe('ruleHeader.context.ceiling {"max":"872K"}');
        cleanup();

        // A ceiling at or below the window says nothing.
        await open({ entry: { max_input_tokens: 272_000, max_context_window: 272_000 } });
        expect(noteIds()).toEqual(['auto', 'apply']);
        cleanup();

        // With 1M already on there is nothing left to open.
        await open({ context1M: true, entry: SOL });
        expect(noteIds()).toEqual(['auto', 'apply']);
    });

    it('rules sharing a request model show the smallest window and ceiling, as the catalog gets', async () => {
        await open({ entry: [SOL, {}, { max_input_tokens: 400_000, max_context_window: 500_000 }] });
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title272K$/);
        expect(note('max')).toBe('ruleHeader.context.ceiling {"max":"500K"}');
        cleanup();
        clearCodexCatalogWindowCache();

        await open({ entry: [SOL, DEEPSEEK] });
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title128K$/);
        expect(noteIds()).toEqual(['auto', 'apply']);
    });

    it('with its own window, only warns when it is above what the model accepts', async () => {
        await open({ window: 1_000_000, entry: SOL });
        expect(noteIds()).toEqual(['over', 'apply']);
        expect(note('over')).toBe('ruleHeader.context.overCeiling {"value":"1M","max":"872K"}');
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title1M$/);
        // The Auto cell still says what Auto would be.
        expect(within(autoCell()).getByText('272K')).toBeInTheDocument();
        cleanup();

        await open({ window: 400_000, entry: SOL });
        expect(noteIds()).toEqual(['apply']);
        cleanup();

        // An unknown model's 200K is a guess, not a limit to warn about.
        await open({ window: 400_000, entry: {} });
        expect(noteIds()).toEqual(['apply']);
    });

    it('marks the window of a model the list does not know as a guess', async () => {
        await open({ entry: {} });
        expect(note('auto')).toBe('ruleHeader.context.autoDefault {"value":"200K"}');
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title200K$/);
        cleanup();
        clearCodexCatalogWindowCache();

        await open({ context1M: true, entry: undefined });
        expect(note('auto')).toBe('ruleHeader.context.autoGuess1M');
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title1M$/);
    });

    it('shows no number until the list is read', async () => {
        await open({ context1M: true, entry: 'never' });
        expect(noteIds()).toEqual(['auto', 'apply']);
        expect(note('auto')).toBe('ruleHeader.context.autoPending');
        expect(within(autoCell()).getByText('…')).toBeInTheDocument();
        expect(header()).toHaveTextContent(/^ruleHeader\.context\.title…$/);
        expect(chipButton()).toHaveAccessibleName('ruleHeader.context.aria {"value":"ruleHeader.context.auto"}');
    });

    it('says when the list could not be read, and treats junk as unknown', async () => {
        await open({ entry: new Error('offline') });
        expect(note('auto')).toBe('ruleHeader.context.autoUnavailable {"value":"200K"}');
        cleanup();
        clearCodexCatalogWindowCache();

        for (const entry of [{ max_input_tokens: '272000' }, { max_input_tokens: -1 }, { max_input_tokens: 1.5 }, { context: 272_000 }]) {
            await open({ entry });
            expect(note('auto'), JSON.stringify(entry)).toBe('ruleHeader.context.autoDefault {"value":"200K"}');
            cleanup();
            clearCodexCatalogWindowCache();
        }
    });

    it('reads again when the 1M flag changes', async () => {
        const view = await open({ entry: { max_input_tokens: 200_000 } });
        fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
        expect(chipButton()).toHaveAccessibleName(/autoValue.*200K/);

        view.rerender(chip({ context1M: true }));
        expect(chipButton()).toHaveAccessibleName('ruleHeader.context.aria {"value":"ruleHeader.context.auto"}');

        serve({ max_input_tokens: 1_000_000 });
        fireEvent.click(chipButton());
        await act(async () => {});
        expect(note('auto')).toBe('ruleHeader.context.auto1M {"value":"1M"}');
    });

    it('keeps the last answer on reopen, and in a new chip, while it is read again', async () => {
        await open({ entry: DEEPSEEK });
        cleanup();
        serve('never');
        render(chip({}));
        fireEvent.click(chipButton());
        await act(async () => {});
        expect(api.listScenarioModels).toHaveBeenCalledTimes(2);
        expect(note('auto')).toBe('ruleHeader.context.autoCatalog {"value":"128K"}');
    });
});

describe('CodexCompactChip', () => {
    const compact = (contextWindow = 0) => (
        <CodexCompactChip percent={0} contextWindow={contextWindow} context1M={false} requestModel="luna" onChange={() => {}} buttonSx={{}} highlightedButtonSx={{}} />
    );
    const openCompact = async (entry: unknown, contextWindow = 0) => {
        api.getAppliedCodexConfig.mockResolvedValue({ preferences: {} });
        serve(entry);
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
        clearCodexCatalogWindowCache();

        // A failed read is no better than a pending one.
        await openCompact(new Error('offline'));
        expect(row('ruleHeader.compact.window')).toHaveTextContent(/…$/);
        expect(row('ruleHeader.compact.remain')).toHaveTextContent(/…$/);
        cleanup();

        await openCompact('never', 256_000);
        expect(row('ruleHeader.compact.window')).toHaveTextContent('256K');
        expect(row('ruleHeader.compact.line')).toHaveTextContent('75% · 192,000 tokens');
    });
});
