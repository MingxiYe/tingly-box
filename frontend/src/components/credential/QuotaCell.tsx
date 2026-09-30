import { Box, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderQuota } from '@/types/quota';
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

interface QuotaCellProps {
    quota: ProviderQuota | undefined;
    refreshing: boolean;
    onRefresh: () => void;
}

/**
 * The Quota column of the credential tables: the same ring the rule graph
 * shows on a service node (remaining share of the binding window), plus that
 * share as "N% left" so a column of rows can be scanned without hovering —
 * "left" matters, a bare percent reads as either used or remaining. Which
 * window binds (bold), every other window, reset times, cost and freshness
 * live in the tooltip; clicking asks upstream for a fresh reading.
 *
 * A provider without a quota reading keeps an empty cell ("—") instead of a
 * placeholder — nothing actionable to say (.design/quota-semantics.md §3.6) —
 * but the cell stays clickable so a reading can still be requested.
 */
export function QuotaCell({ quota, refreshing, onRefresh }: QuotaCellProps) {
    const { t } = useTranslation();
    const { resourceItems } = useQuotaBars(quota);
    const windows = quotaToWindows(quota);
    const tightest = tightestWindow(quota);
    // No countable window: a balance-only reading (e.g. Codex credits) still
    // has a figure of its own — shown as text, never as a ring or a percent.
    const balance = tightest ? undefined : windows.find(({ window }) => window.available != null);

    const now = Date.now();
    const fetchedAt = quota?.fetched_at ? new Date(quota.fetched_at).getTime() : NaN;
    const stale = Number.isFinite(fetchedAt) && now - fetchedAt > STALE_AFTER_MS;
    const lastError = quota?.last_error;

    const remaining = tightest ? quotaRemainingPercent(tightest) : 0;

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
            {!tightest && !balance && (
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
        </Box>
    );

    let figure: ReactNode;
    if (tightest) {
        figure = (
            <>
                <Box component="span" sx={{ display: 'inline-flex', ...(refreshing && quotaRingSpinSx) }}>
                    {/* While refreshing, a fixed quarter arc spins like a loader — the
                        real arc can be empty (used up), and an empty ring shows no motion. */}
                    <QuotaRing remaining={refreshing ? 25 : remaining} color={quotaRingColor(remaining)} size={18} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {t('rule.service.quota.left', { value: `${Math.round(remaining)}%` })}
                </Typography>
            </>
        );
    } else if (balance) {
        figure = (
            <>
                <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', opacity: refreshing ? 0.5 : 1 }}>
                    {formatQuotaAvailable(balance.window, formatNumber)}
                </Typography>
            </>
        );
    } else if (refreshing) {
        figure = (
            <Box component="span" sx={{ display: 'inline-flex', ...quotaRingSpinSx }}>
                <QuotaRing remaining={25} color={QUOTA_COLORS.secondary} size={18} />
            </Box>
        );
    } else {
        figure = <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>;
    }

    return (
        <Tooltip title={tooltip} arrow placement="top">
            <Box
                component="span"
                role="button"
                tabIndex={0}
                aria-label={tightest
                    ? t('rule.service.quota.left', { value: `${Math.round(remaining)}%` })
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
                    gap: 0.75,
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

