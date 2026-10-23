import { Box, Button, Link, Popover, Slider, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExpandMore as ExpandMoreIcon } from '@/components/icons';
import { api } from '@/services/api';
import { fontSizes } from '@/theme/fonts';
import {
    CODEX_COMPACT,
    derivedWindow,
    formatWindow,
    isValidWindowOverride,
    lowZoneStart,
    parseWindowInput,
    planCodexCompact,
    resolveChipWindow,
    trackPosition,
    type CodexCompactStatus,
    type CodexDetectedWindow,
} from './codexCompact';

interface CodexCompactChipProps {
    /** The rule's request model: the catalog slug its window is keyed by. */
    modelName: string;
    /** The rule's own percent; 0 = follow the Auto Config default. */
    percent: number;
    /** Whether the rule's 1M flag is on (only a fallback until the derived window loads). */
    context1M: boolean;
    /** The rule's own window in tokens; 0 = use the window derived from its upstreams. */
    windowOverride?: number;
    disabled?: boolean;
    onChange: (percent: number) => void;
    onWindowChange?: (tokens: number) => void;
    buttonSx: SxProps<Theme>;
    highlightedButtonSx: SxProps<Theme>;
}

const fmt = (n: number) => n.toLocaleString('en-US');

// What Auto Config currently holds (the shared default every rule without its
// own value follows). Read lazily, when the popover opens.
interface SharedDefaults {
    percent: number;
    effective: number;
}

const parsePercent = (raw: unknown, fallback: number): number => {
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) && n >= CODEX_COMPACT.min && n <= 100 ? n : fallback;
};

const NOTE_COLOR: Record<Exclude<CodexCompactStatus, 'ok'>, 'warning' | 'info'> = {
    low: 'warning',
    limited: 'info',
};

/**
 * The "Compact: 75%" chip on a Codex rule's header: opens a popover with a
 * slider for the share of the context window at which Codex auto-compacts this
 * model. Config-only — it lands in the generated Codex model catalog the next
 * time Auto Config is applied and never touches request routing.
 */
export const CodexCompactChip: React.FC<CodexCompactChipProps> = ({
    modelName,
    percent,
    context1M,
    windowOverride = 0,
    disabled,
    onChange,
    onWindowChange,
    buttonSx,
    highlightedButtonSx,
}) => {
    const { t } = useTranslation();
    const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
    const [draft, setDraft] = React.useState<number | null>(null);
    const [shared, setShared] = React.useState<SharedDefaults>({
        percent: CODEX_COMPACT.defaultPercent,
        effective: CODEX_COMPACT.defaultEffectivePercent,
    });

    // What the server derives for this model from the rule's upstreams, and
    // whether that answer is in (until then the window is only a guess).
    const [detected, setDetected] = React.useState<CodexDetectedWindow | null>(null);
    const [windowLoad, setWindowLoad] = React.useState<'loading' | 'ready' | 'error'>('loading');
    // Inline window editor: null = closed, else the text being typed.
    const [windowDraft, setWindowDraft] = React.useState<string | null>(null);

    const open = Boolean(anchor);
    const overridden = percent > 0;
    const shown = draft ?? (overridden ? percent : shared.percent);
    const resolvedWindow = resolveChipWindow({ override: windowOverride, detected, context1M });
    const window = resolvedWindow.window;
    const fallbackWindow = resolveChipWindow({ override: 0, detected, context1M });
    const plan = planCodexCompact({ window, percent: shown, effectivePercent: shared.effective });
    const lowStart = lowZoneStart(window);
    const noteKindForPlan = plan.status === 'ok' ? null : NOTE_COLOR[plan.status];

    React.useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setDetected(null);
        setWindowLoad('loading');
        (async () => {
            try {
                const result = await api.getAppliedCodexConfig();
                const prefs = result?.preferences ?? {};
                if (!cancelled) {
                    setShared({
                        percent: parsePercent(prefs.auto_compact_percent, CODEX_COMPACT.defaultPercent),
                        effective: parsePercent(prefs.effective_context_window_percent, CODEX_COMPACT.defaultEffectivePercent),
                    });
                    setDetected(derivedWindow(result?.contextWindows?.[modelName.trim()]));
                    setWindowLoad('ready');
                }
            } catch {
                // Keep the built-in defaults; the preview is only a hint.
                if (!cancelled) setWindowLoad('error');
            }
        })();
        return () => { cancelled = true; };
    }, [open, modelName]);

    // Arrow keys commit on every press; wait until the value settles so one
    // adjustment is one save.
    const pending = React.useRef<{ timer: ReturnType<typeof setTimeout>; value: number } | null>(null);
    const flush = React.useCallback(() => {
        if (!pending.current) return;
        clearTimeout(pending.current.timer);
        const { value } = pending.current;
        pending.current = null;
        onChange(value);
        setDraft(null);
    }, [onChange]);
    const commit = (value: number) => {
        if (pending.current) clearTimeout(pending.current.timer);
        pending.current = { value, timer: setTimeout(flush, 500) };
    };
    // A value still waiting out its debounce is saved, not dropped, if the card
    // goes away first.
    const flushRef = React.useRef(flush);
    flushRef.current = flush;
    React.useEffect(() => () => flushRef.current(), []);

    const close = () => {
        flush();
        setAnchor(null);
        setDraft(null);
        setWindowDraft(null);
    };

    // Closing the editor hands focus back to "Change" instead of the popover.
    const changeLinkRef = React.useRef<HTMLButtonElement | null>(null);
    const closeWindowEditor = () => {
        setWindowDraft(null);
        requestAnimationFrame(() => changeLinkRef.current?.focus());
    };
    const windowDraftTokens = windowDraft === null ? Number.NaN : parseWindowInput(windowDraft);
    const windowDraftValid = windowDraft !== null && isValidWindowOverride(windowDraftTokens);
    const saveWindow = () => {
        if (!windowDraftValid || !onWindowChange) return;
        // Typing the detected value back is the same as following it — but
        // only when the server's answer is in, not against the guess.
        const follows = windowLoad === 'ready' && windowDraftTokens === fallbackWindow.window;
        onWindowChange(follows ? 0 : windowDraftTokens);
        closeWindowEditor();
    };
    const windowPinned = resolvedWindow.source === 'override';
    // While loading only a pinned window is known for sure.
    const windowKnown = windowPinned || windowLoad === 'ready';
    // Numbers worked out from a guessed window would flash and change.
    const showNumbers = windowKnown || windowLoad === 'error';
    const noteKind = showNumbers ? noteKindForPlan : null;

    const windowSource = !windowKnown
        ? (windowLoad === 'error' ? t('ruleHeader.compact.windowSource.unavailable') : '')
        : {
            override: t('ruleHeader.compact.windowSource.override'),
            catalog: t('ruleHeader.compact.windowSource.catalog', { model: resolvedWindow.model, provider: resolvedWindow.provider }),
            context_1m: t('ruleHeader.compact.windowSource.context_1m'),
            default: t('ruleHeader.compact.windowSource.default'),
        }[resolvedWindow.source];
    const chipValue = [
        overridden ? `${percent}%` : t('ruleHeader.compact.auto'),
        ...(isValidWindowOverride(windowOverride) ? [formatWindow(windowOverride)] : []),
    ].join(' · ');
    const chipHighlighted = overridden || isValidWindowOverride(windowOverride);

    const noteText = {
        low: t('ruleHeader.compact.low', { remain: fmt(plan.remain), min: fmt(CODEX_COMPACT.minRemaining) }),
        limited: t('ruleHeader.compact.limited', { effective: shared.effective, applied: plan.applied }),
        ok: '',
    }[plan.status];

    return (
        <Box sx={{ ml: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <Tooltip title={t('ruleHeader.compact.tooltip')}>
                <span>
                    <Button
                        size="small"
                        variant="outlined"
                        color={chipHighlighted ? 'primary' : 'inherit'}
                        endIcon={<ExpandMoreIcon sx={{ fontSize: 14 }} />}
                        disabled={disabled}
                        aria-label={t('ruleHeader.compact.aria', { value: chipValue })}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        onClick={(e) => setAnchor(e.currentTarget)}
                        sx={chipHighlighted ? highlightedButtonSx : buttonSx}
                    >
                        {t('ruleHeader.compact.chip', { value: chipValue })}
                    </Button>
                </span>
            </Tooltip>
            <Popover
                open={open}
                anchorEl={anchor}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                onClose={close}
                onClick={(e) => e.stopPropagation()}
                slotProps={{ paper: { sx: { width: 340, p: 2, borderRadius: 2 } } }}
            >
                <Stack spacing={1.5}>
                    <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <Typography sx={{ fontSize: fontSizes.md, fontWeight: 600 }}>{t('ruleHeader.compact.title')}</Typography>
                        <Typography sx={{ fontSize: fontSizes.lg, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {shown}%
                        </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: fontSizes.sm }}>
                        {overridden || draft !== null
                            ? t('ruleHeader.compact.description')
                            : t('ruleHeader.compact.following', { percent: shared.percent })}
                    </Typography>

                    <Box>
                        <Box sx={{ position: 'relative', px: 0.5 }}>
                            {/* Rail and the "too few tokens left" zone. */}
                            <Box sx={{ position: 'absolute', left: 4, right: 4, top: '50%', height: 4, mt: '-2px', borderRadius: 2, bgcolor: 'action.disabledBackground', overflow: 'hidden' }}>
                                {lowStart !== null && (
                                    <Box sx={{
                                        position: 'absolute', top: 0, bottom: 0,
                                        left: `${trackPosition(lowStart)}%`,
                                        right: 0,
                                        bgcolor: (theme) => alpha(theme.palette.warning.main, 0.55),
                                    }} />
                                )}
                            </Box>
                            <Slider
                                size="small"
                                min={CODEX_COMPACT.min}
                                max={CODEX_COMPACT.max}
                                step={1}
                                value={shown}
                                disabled={disabled}
                                onChange={(_, v) => setDraft(v as number)}
                                onChangeCommitted={(_, v) => {
                                    const next = v as number;
                                    setDraft(next);
                                    commit(next);
                                }}
                                aria-label={t('ruleHeader.compact.title')}
                                valueLabelDisplay="off"
                                sx={{ '& .MuiSlider-rail': { opacity: 0 }, '& .MuiSlider-track': { height: 4, border: 0 } }}
                            />
                        </Box>
                        <Box sx={{ position: 'relative', height: 16, fontSize: fontSizes.xs, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                            <span style={{ position: 'absolute', left: 0 }}>{CODEX_COMPACT.min}%</span>
                            {lowStart !== null && (
                                <span style={{ position: 'absolute', left: `${trackPosition(lowStart)}%`, transform: 'translateX(-50%)' }}>
                                    {Math.round(lowStart)}%
                                </span>
                            )}
                            <span style={{ position: 'absolute', right: 0 }}>100%</span>
                        </Box>
                    </Box>

                    <Stack spacing={0.25} sx={{ fontSize: fontSizes.sm, fontVariantNumeric: 'tabular-nums' }}>
                        {/* The window first: the other two rows follow from it. */}
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <Box component="span" sx={{ color: 'text.secondary' }}>{t('ruleHeader.compact.window')}</Box>
                            <Box component="span">{showNumbers ? formatWindow(window) : '…'}</Box>
                        </Stack>
                        {(windowSource || (onWindowChange && windowDraft === null)) && (
                            <Box sx={{ color: 'text.secondary', fontSize: fontSizes.xs, pb: 0.5 }}>
                                {windowSource}
                                {onWindowChange && windowDraft === null && showNumbers && (
                                    <>
                                        {windowSource && ' · '}
                                        <Link
                                            ref={changeLinkRef}
                                            component="button"
                                            type="button"
                                            underline="hover"
                                            disabled={disabled}
                                            onClick={() => setWindowDraft(formatWindow(window))}
                                            sx={{ fontSize: fontSizes.xs, verticalAlign: 'baseline' }}
                                        >
                                            {t('ruleHeader.compact.windowEdit')}
                                        </Link>
                                        {windowPinned && (
                                            <>
                                                {' · '}
                                                <Link
                                                    component="button"
                                                    type="button"
                                                    underline="hover"
                                                    disabled={disabled}
                                                    onClick={() => onWindowChange(0)}
                                                    sx={{ fontSize: fontSizes.xs, verticalAlign: 'baseline' }}
                                                >
                                                    {windowLoad === 'ready'
                                                        ? t('ruleHeader.compact.windowReset', { window: formatWindow(fallbackWindow.window) })
                                                        : t('ruleHeader.compact.windowResetPlain')}
                                                </Link>
                                            </>
                                        )}
                                    </>
                                )}
                            </Box>
                        )}
                        {windowDraft !== null && (
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.5 }}>
                                <TextField
                                    size="small"
                                    autoFocus
                                    fullWidth
                                    label={t('ruleHeader.compact.windowLabel')}
                                    value={windowDraft}
                                    onChange={(e) => setWindowDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); saveWindow(); }
                                        if (e.key === 'Escape') { e.stopPropagation(); closeWindowEditor(); }
                                    }}
                                    error={windowDraft.trim() !== '' && !windowDraftValid}
                                    helperText={windowDraft.trim() !== '' && !windowDraftValid
                                        ? t('ruleHeader.compact.windowInvalid', { min: formatWindow(CODEX_COMPACT.windowOverrideMin), max: formatWindow(CODEX_COMPACT.windowOverrideMax) })
                                        : windowDraftValid
                                            ? t('ruleHeader.compact.windowParsed', { tokens: fmt(windowDraftTokens) })
                                            : t('ruleHeader.compact.windowHint')}
                                    slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                                />
                                <Button size="small" variant="contained" disabled={!windowDraftValid} onClick={saveWindow} sx={{ mt: 0.25 }}>
                                    {t('ruleHeader.compact.windowSave')}
                                </Button>
                            </Stack>
                        )}
                        {[
                            [t('ruleHeader.compact.line'), showNumbers ? `${plan.applied}% · ${fmt(plan.line)} tokens` : '…', undefined],
                            [t('ruleHeader.compact.remain'), showNumbers ? `${fmt(plan.remain)} tokens` : '…', showNumbers && plan.status === 'low' ? 'warning.dark' : 'text.primary'],
                        ].map(([label, value, color]) => (
                            <Stack key={label} direction="row" sx={{ justifyContent: 'space-between' }}>
                                <Box component="span" sx={{ color: 'text.secondary' }}>{label}</Box>
                                <Box component="span" sx={{ color: color ?? 'text.primary', fontWeight: color ? 600 : 400 }}>{value}</Box>
                            </Stack>
                        ))}
                    </Stack>

                    {noteKind && (
                        <Box sx={{
                            p: 1, borderRadius: 1, fontSize: fontSizes.sm, lineHeight: 1.45,
                            color: `${noteKind}.dark`,
                            bgcolor: (theme) => alpha(theme.palette[noteKind].main, 0.1),
                            border: '1px solid',
                            borderColor: (theme) => alpha(theme.palette[noteKind].main, 0.4),
                        }}>
                            {noteText}
                        </Box>
                    )}

                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', pt: 1, borderTop: 1, borderColor: 'divider', fontSize: fontSizes.xs, color: 'text.secondary' }}>
                        <span>{t('ruleHeader.compact.needsApply')}</span>
                        {overridden && (
                            <Link
                                component="button"
                                type="button"
                                underline="hover"
                                onClick={() => { if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; } setDraft(null); onChange(0); }}
                                sx={{ fontSize: fontSizes.xs }}
                            >
                                {t('ruleHeader.compact.reset', { percent: shared.percent })}
                            </Link>
                        )}
                    </Stack>
                </Stack>
            </Popover>
        </Box>
    );
};

export default CodexCompactChip;
