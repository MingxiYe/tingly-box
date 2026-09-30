// Dashboard › Overview — answers "is everything working, and does anything
// need me?" before the usage charts do (see .design/ui-redesign.md §3.3).
// Three sections, one per question: is the gateway up; what needs attention
// (each item carries its next action); what did each agent do lately.
import {
    ArrowForward,
    CheckCircle,
    ErrorOutline,
    Refresh,
    UpgradeOutlined,
    WarningAmber,
} from '@/components/icons';
import { Box, Button, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import CopyIconButton from '@/components/CopyIconButton';
import PageHeader from '@/components/PageHeader';
import Surface from '@/components/Surface';
import { useHealth } from '@/contexts/HealthContext';
import { useVersion } from '@/contexts/VersionContext';
import { SCENARIOS, useHiddenScenarios } from '@/pages/scenario/scenarioRegistry';
import { api, fetchUIAPI } from '@/services/api';
import { fontMono } from '@/theme/fonts';
import type { ProviderQuota } from '@/types/quota';
import { getLocalMidnight, toLocalISOString } from '@/utils/datetime';
import { getApiBaseUrl } from '@/utils/protocol';
import { timeAgo } from '@/utils/timeAgo';
import {
    buildAttentionItems,
    summarizeAgentActivity,
    type AgentActivity,
    type AttentionItem,
    type ProviderLike,
} from './overviewModel';

const ACTIVITY_DAYS = 7;
// Enough recent records to find the latest request of every agent in
// practice; request counts come from the aggregated stats, not from these.
const RECENT_RECORD_LIMIT = 500;

interface OverviewData {
    providers: ProviderLike[];
    quotas: Record<string, ProviderQuota | undefined>;
    todayRequests: number;
    todayErrors: number;
    activity: Record<string, AgentActivity>;
}

const sumStats = (rows: Array<{ request_count?: number; error_count?: number }>) =>
    rows.reduce((acc, r) => ({ requests: acc.requests + (r.request_count ?? 0), errors: acc.errors + (r.error_count ?? 0) }), { requests: 0, errors: 0 });

async function loadOverview(): Promise<OverviewData> {
    const now = new Date();
    const since = new Date(now.getTime() - ACTIVITY_DAYS * 24 * 3600 * 1000);
    const [providersRes, todayRes, weekRes, recordsRes] = await Promise.all([
        api.getProviders().catch(() => undefined),
        api.getUsageStats({ group_by: 'scenario', start_time: toLocalISOString(getLocalMidnight(now)), end_time: toLocalISOString(now) }).catch(() => undefined),
        api.getUsageStats({ group_by: 'scenario', start_time: toLocalISOString(since), end_time: toLocalISOString(now), limit: 1000 }).catch(() => undefined),
        api.getUsageRecords({ start_time: toLocalISOString(since), end_time: toLocalISOString(now), limit: RECENT_RECORD_LIMIT }).catch(() => undefined),
    ]);

    const providers: ProviderLike[] = Array.isArray(providersRes?.data) ? providersRes.data : [];
    const enabled = providers.filter(p => p.enabled !== false).map(p => p.uuid);
    let quotas: Record<string, ProviderQuota | undefined> = {};
    if (enabled.length > 0) {
        // Quota is best-effort here: the Credentials page owns reporting
        // quota failures, the overview just skips what it can't read.
        quotas = await fetchUIAPI('/provider-quota/batch', {
            method: 'POST',
            body: JSON.stringify({ provider_uuids: enabled }),
        }).then(r => r?.data ?? {}).catch(() => ({}));
    }

    const today = sumStats(Array.isArray(todayRes?.data) ? todayRes.data : []);
    return {
        providers,
        quotas,
        todayRequests: today.requests,
        todayErrors: today.errors,
        activity: summarizeAgentActivity(
            Array.isArray(recordsRes?.data) ? recordsRes.data : [],
            Array.isArray(weekRes?.data) ? weekRes.data : [],
        ),
    };
}

const SectionTitle = ({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) => (
    <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 1.5, gap: 2 }}>
        <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
            {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {action}
    </Stack>
);

const StatusOverviewPage = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isHealthy, checking, checkHealth } = useHealth();
    const { currentVersion, hasUpdate, showUpdateDialog } = useVersion();
    const { isHidden } = useHiddenScenarios();
    const [baseUrl, setBaseUrl] = useState('');
    const [data, setData] = useState<OverviewData | null>(null);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setData(await loadOverview());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        getApiBaseUrl().then(url => { if (!cancelled) setBaseUrl(url); });
        loadOverview().then(d => {
            if (cancelled) return;
            setData(d);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    const attention = useMemo(() => buildAttentionItems({
        healthy: isHealthy,
        hasUpdate,
        providers: data?.providers ?? [],
        quotas: data?.quotas ?? {},
    }), [isHealthy, hasUpdate, data]);

    // Recently active agents first (newest on top); the rest keep the
    // sidebar order.
    const agents = useMemo(() => {
        const visible = SCENARIOS.filter(s => !isHidden(s.id));
        const lastAt = (id: string) => {
            const at = data?.activity[id]?.lastAt;
            return at ? new Date(at).getTime() : 0;
        };
        return [...visible].sort((a, b) => lastAt(b.id) - lastAt(a.id));
    }, [isHidden, data]);

    const errorRate = data && data.todayRequests > 0 ? (data.todayErrors / data.todayRequests) * 100 : 0;

    const attentionRow = (item: AttentionItem, index: number) => {
        let icon = <WarningAmber sx={{ fontSize: 20 }} color="warning" />;
        let text = '';
        let action: React.ReactNode = null;
        switch (item.kind) {
            case 'disconnected':
                icon = <ErrorOutline sx={{ fontSize: 20 }} color="error" />;
                text = t('statusOverview.attention.disconnected');
                action = <Button size="small" onClick={() => void checkHealth()} disabled={checking}>{t('health.retry')}</Button>;
                break;
            case 'oauthExpired':
                icon = <ErrorOutline sx={{ fontSize: 20 }} color="error" />;
                text = t('statusOverview.attention.oauthExpired', { provider: item.providerName });
                action = <Button size="small" onClick={() => navigate('/credentials')}>{t('statusOverview.attention.openCredentials')}</Button>;
                break;
            case 'quotaLow':
                text = t('statusOverview.attention.quotaLow', { provider: item.providerName, window: item.windowLabel, percent: item.percentLeft });
                action = <Button size="small" onClick={() => navigate('/credentials')}>{t('statusOverview.attention.viewQuota')}</Button>;
                break;
            case 'update':
                icon = <UpgradeOutlined sx={{ fontSize: 20 }} color="info" />;
                text = t('statusOverview.attention.update');
                action = <Button size="small" onClick={showUpdateDialog}>{t('statusOverview.attention.viewUpdate')}</Button>;
                break;
        }
        return (
            <Stack key={index} direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 1, borderTop: index ? '1px solid' : 'none', borderColor: 'divider' }}>
                {icon}
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{text}</Typography>
                {action}
            </Stack>
        );
    };

    return (
        <Stack spacing={2.5}>
            <PageHeader
                title={t('statusOverview.title')}
                subtitle={t('statusOverview.subtitle')}
                actions={
                    <Tooltip title={t('common.refresh')} arrow>
                        <span>
                            <IconButton onClick={() => void reload()} disabled={loading} size="small">
                                {loading ? <CircularProgress size={18} /> : <Refresh sx={{ fontSize: 20 }} />}
                            </IconButton>
                        </span>
                    </Tooltip>
                }
            />

            {/* Is the gateway up? */}
            <Surface variant="outlined">
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 3 }} sx={{ alignItems: { md: 'center' } }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: isHealthy ? 'success.main' : 'error.main' }} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {isHealthy ? t('statusOverview.gateway.running') : t('statusOverview.gateway.unreachable')}
                        </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontFamily: fontMono, color: 'primary.main', overflowWrap: 'anywhere' }}>{baseUrl}</Typography>
                        {baseUrl && <CopyIconButton value={baseUrl} size="small" iconSize={16} />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        {t('statusOverview.gateway.version', { version: currentVersion })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ ml: { md: 'auto' } }}>
                        {data
                            ? t('statusOverview.gateway.today', { count: data.todayRequests, errorRate: errorRate.toFixed(1) })
                            : '—'}
                    </Typography>
                </Stack>
            </Surface>

            {/* What needs me? */}
            <Surface variant="outlined">
                <SectionTitle title={attention.length > 0 ? t('statusOverview.attention.titleCount', { count: attention.length }) : t('statusOverview.attention.title')} />
                {attention.length === 0 ? (
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 0.5 }}>
                        <CheckCircle sx={{ fontSize: 20 }} color="success" />
                        <Typography variant="body2" color="text.secondary">
                            {loading ? t('statusOverview.attention.checking') : t('statusOverview.attention.none')}
                        </Typography>
                    </Stack>
                ) : attention.map(attentionRow)}
            </Surface>

            {/* What did my agents do? */}
            <Surface variant="outlined">
                <SectionTitle
                    title={t('statusOverview.agents.title')}
                    subtitle={t('statusOverview.agents.subtitle', { days: ACTIVITY_DAYS })}
                    action={<Button size="small" endIcon={<ArrowForward sx={{ fontSize: 16 }} />} onClick={() => navigate('/dashboard/7d')}>{t('statusOverview.agents.viewUsage')}</Button>}
                />
                {agents.map((s, index) => {
                    const a = data?.activity[s.id];
                    const route = a?.model
                        ? `${a.requestModel && a.requestModel !== a.model ? `${a.requestModel} → ` : ''}${a.model}${a.providerName ? ` · ${a.providerName}` : ''}`
                        : '';
                    return (
                        <Stack
                            key={s.id}
                            direction="row"
                            spacing={1.5}
                            onClick={() => navigate(s.path)}
                            sx={{
                                alignItems: 'center', py: 1, px: 1, mx: -1, borderRadius: 1, cursor: 'pointer',
                                borderTop: index ? '1px solid' : 'none', borderColor: 'divider',
                                '&:hover': { bgcolor: 'action.hover' },
                            }}
                        >
                            <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{s.icon(20)}</Box>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t(s.labelKey)}</Typography>
                                <Typography variant="caption" color="text.secondary" noWrap component="div">
                                    {a?.lastAt ? (
                                        <>
                                            {timeAgo(a.lastAt)}
                                            {route && <Box component="span" sx={{ fontFamily: fontMono, ml: 1 }}>{route}</Box>}
                                        </>
                                    ) : loading ? '…' : t('statusOverview.agents.noRequests')}
                                </Typography>
                            </Box>
                            {a && a.requestCount > 0 && (
                                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                                    {t('statusOverview.agents.requests', { count: a.requestCount })}
                                </Typography>
                            )}
                            <ArrowForward sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
                        </Stack>
                    );
                })}
            </Surface>
        </Stack>
    );
};

export default StatusOverviewPage;
