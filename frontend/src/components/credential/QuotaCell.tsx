import { Box, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderQuota, QuotaWindowDisplayItem } from '@/types/quota';
import {
    formatQuotaAvailable,
    formatQuotaRemaining,
    isCountable,
    quotaRemainingPercent,
    quotaToWindows,
    tightestWindow,
} from '@/types/quota';
import { QUOTA_COLORS, formatNumber } from '../dashboard/chartStyles';
import { QuotaRing, formatQuotaDuration, quotaRingColor, quotaRingSpinSx } from './QuotaRing';
import { useQuotaBars } from './useQuotaBars';

// Older than this, the figure is dimmed: the cache is refreshed in the
// background, so a stale snapshot means the refresher could not reach upstream.
const STALE_AFTER_MS = 60 * 60 * 1000;

// Lines shown in the cell. Two fit the row height the Actions group already
// sets, so a provider with quota is no taller than one without.
const MAX_LINES = 2;

interface QuotaCellProps {
    quota: ProviderQuota | undefined;
    refreshing: boolean;
    onRefresh: () => void;
}

/** "5h" / "7d" / "30m" from a window's period; undefined when it has none. */
function periodLabel(minutes?: number): string | undefined {
    if (!minutes || minutes <= 0) return undefined;
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
}

/**
 * The Quota column of the credential tables. One line per window worth a
 * figure — the same ring the rule graph shows on a service node, the window's
 * name, and the share left ("left", not a bare percent, which reads as either
 * used or remaining). Balance-only windows show their value with no ring.
 *
 * Windows keep quotaToWindows' order (self-healing limits first, shorter
 * periods first), so a 5h + weekly plan reads "5h" then "7d". Beyond
 * MAX_LINES a "+N" marks the rest; every window, reset time, cost and
 * freshness is in the tooltip, and clicking asks upstream for a fresh reading.
 *
 * No reading → "—", nothing more (.design/quota-semantics.md §3.6), but the
 * cell stays clickable so a reading can still be requested.
 */
export function QuotaCell({ quota, refreshing, onRefresh }: QuotaCellProps) {
    const { t } = useTranslation();
    const { resourceItems } = useQuotaBars(quota);
    const windows = quotaToWindows(quota);
    const tightest = tightestWindow(quota);
    const shown = windows.filter(({ window }) => isCountable(window) || window.available != null);
    const lines = shown.slice(0, MAX_LINES);
    const hidden = shown.length - lines.length;

    // Name by period ("5h", "7d") when that tells the lines apart — short and
    // scannable down a column. Two windows of the same period (e.g. per-model
    // daily limits) need their own labels instead.
    const periods = lines.map(({ window }) => periodLabel(window.window_minutes));
    const periodsDistinct = periods.every(p => p) && new Set(periods).size === periods.length;
    const nameOf = (item: QuotaWindowDisplayItem, i: number) => (periodsDistinct ? periods[i] : item.label);

    const now = Date.now();
    const fetchedAt = quota?.fetched_at ? new Date(quota.fetched_at).getTime() : NaN;
    const stale = Number.isFinite(fetchedAt) && now - fetchedAt > STALE_AFTER_MS;
    const lastError = quota?.last_error;
    const hasRaw = quota?.raw_response != null;

    const tooltip = (
        <Box sx={{ minWidth: 160 }}>
            {windows.map(({ key, label, window }) => {
                const value = isCountable(window)
                    ? t('rule.service.quota.left', { value: formatQuotaRemaining(window, formatNumber) })
                    : formatQuotaAvailable(window, formatNumber);
                if (!value) return null;
                const resetsAt = window.resets_at ? new Date(window.resets_at).getTime() : NaN;
                return (
                    <Box key={key} sx={{ mb: 0.25, fontWeight: window === tightest ? 700 : 400 }}>
                        {label}: {value}
                        {Number.isFinite(resetsAt) && resetsAt > now && (
                            <> · {t('rule.service.quota.resetsIn', { duration: formatQuotaDuration(resetsAt - now) })}</>
                        )}
                    </Box>
                );
            })}
            {resourceItems.map(item => (
                <Box key={item.key} sx={{ mb: 0.25 }}>{item.window.label}: {item.countLabel}</Box>
            ))}
            {quota?.cost && (
                <Box sx={{ mb: 0.25 }}>
                    {t('providerTable.quota.cost')}: {quota.cost.limit > 0
                        ? `${quota.cost.currency_code || '$'}${Math.max(0, quota.cost.limit - quota.cost.used).toFixed(2)} / ${quota.cost.currency_code || '$'}${quota.cost.limit.toFixed(2)}`
                        : `${quota.cost.currency_code || '$'}${quota.cost.used.toFixed(2)}`}
                </Box>
            )}
            {shown.length === 0 && (
                <Box sx={{ mb: 0.25, color: lastError ? QUOTA_COLORS.error : undefined }}>
                    {lastError
                        ? t('providerTable.quota.readFailed')
                        : quota ? t('providerTable.quota.noLimits') : t('providerTable.quota.none')}
                </Box>
            )}
            <Box sx={{ mt: 0.5, opacity: 0.7 }}>
                {refreshing
                    ? t('rule.service.quota.refreshing')
                    : [
                        Number.isFinite(fetchedAt) && t('rule.service.quota.updated', { duration: formatQuotaDuration(now - fetchedAt) }),
                        t('rule.service.quota.clickToRefresh'),
                    ].filter(Boolean).join(' · ')}
            </Box>
            {hasRaw && !lastError && (
                <Box sx={{ opacity: 0.7 }}>{t('providerTable.quota.detailsHint')}</Box>
            )}
        </Box>
    );

    let figure: ReactNode;
    if (lines.length > 0) {
        figure = (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0, opacity: refreshing ? 0.6 : 1 }}>
                {lines.map((item, i) => {
                    const { window } = item;
                    const countable = isCountable(window);
                    const remaining = countable ? quotaRemainingPercent(window) : 0;
                    return (
                        <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            {countable ? (
                                <Box component="span" sx={{ display: 'inline-flex', ...(refreshing && quotaRingSpinSx) }}>
                                    {/* While refreshing, a fixed quarter arc spins like a loader — the
                                        real arc can be empty (used up), and an empty ring shows no motion. */}
                                    <QuotaRing remaining={refreshing ? 25 : remaining} color={quotaRingColor(remaining)} size={14} />
                                </Box>
                            ) : (
                                // Keeps balance lines aligned with the ringed ones above/below.
                                <Box component="span" sx={{ width: 14, flexShrink: 0 }} />
                            )}
                            <Typography
                                variant="caption"
                                sx={{
                                    color: 'text.secondary',
                                    flexShrink: 1,
                                    minWidth: periodsDistinct ? 22 : 0,
                                    maxWidth: periodsDistinct ? undefined : 64,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {nameOf(item, i)}
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'text.primary' }}
                            >
                                {countable
                                    ? t('rule.service.quota.left', { value: `${Math.round(remaining)}%` })
                                    : formatQuotaAvailable(window, formatNumber)}
                            </Typography>
                            {hidden > 0 && i === lines.length - 1 && (
                                <Typography variant="caption" sx={{ color: 'text.disabled', whiteSpace: 'nowrap' }}>
                                    +{hidden}
                                </Typography>
                            )}
                        </Box>
                    );
                })}
            </Box>
        );
    } else if (refreshing) {
        figure = (
            <Box component="span" sx={{ display: 'inline-flex', ...quotaRingSpinSx }}>
                <QuotaRing remaining={25} color={QUOTA_COLORS.secondary} size={14} />
            </Box>
        );
    } else {
        figure = <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>;
    }

    const tightestRemaining = tightest ? Math.round(quotaRemainingPercent(tightest)) : undefined;
    return (
        <Tooltip title={tooltip} arrow placement="top">
            <Box
                component="span"
                role="button"
                tabIndex={0}
                aria-label={tightestRemaining != null
                    ? t('rule.service.quota.left', { value: `${tightestRemaining}%` })
                    : t('providerTable.quota.refresh')}
                aria-busy={refreshing}
                onClick={() => !refreshing && onRefresh()}
                onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (!refreshing) onRefresh();
                }}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    maxWidth: '100%',
                    minWidth: 0,
                    px: 0.75,
                    py: 0.25,
                    mx: -0.75,
                    borderRadius: 1,
                    opacity: stale && !refreshing ? 0.5 : 1,
                    cursor: refreshing ? 'progress' : 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                }}
            >
                {figure}
            </Box>
        </Tooltip>
    );
}
