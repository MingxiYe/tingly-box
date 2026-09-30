import {
    Box,
    Card,
    CardActionArea,
    Chip,
    Grid,
    IconButton,
    Skeleton,
    Stack,
    Tooltip,
    Typography,
    alpha,
} from '@mui/material';
import {
    ArrowForward,
    ErrorOutline,
    ExpandMore,
    UpgradeOutlined,
    Visibility as IconVisibility,
    VisibilityOff as IconVisibilityOff,
    WarningAmber,
} from '@/components/icons';
import { Button, Collapse } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, fetchUIAPI } from '@/services/api';
import { controlApi } from '@/services/openapi';
import { ClientConfigStatusChip } from '@/components/ClientConfigStatusChip';
import type { ClientConfigStatus } from '@/hooks/useClientConfigStatus';
import { useHealth } from '@/contexts/HealthContext';
import { useVersion } from '@/contexts/VersionContext';
import { fontMono } from '@/theme/fonts';
import type { ProviderQuota } from '@/types/quota';
import { toLocalISOString } from '@/utils/datetime';
import { timeAgo } from '@/utils/timeAgo';
import {
    buildAttentionItems,
    hasRoutableService,
    isAgentInUse,
    summarizeAgentActivity,
    type AgentActivity,
    type AttentionItem,
    type ProviderLike,
    type RuleLike,
} from './homeModel';
import PageLayout from '@/components/PageLayout';
import { SCENARIOS, useHiddenScenarios, type ScenarioDescriptor } from './scenarioRegistry';
import PowerUpsSection from './PowerUpsSection';
import UnifiedCard from '@/components/UnifiedCard';

const scenarioIconSize = 28;

// Cap the page body so the card grid keeps a readable column width on wide
// monitors instead of stretching to the window. Centered, so the page still
// reads as one column of content rather than a left-anchored strip.
const pageContentMaxWidth = 1280;

interface AgentCardProps {
    scenario: ScenarioDescriptor;
    routable: boolean | undefined;
    loaded: boolean;
    hidden: boolean;
    onOpen: () => void;
    onToggleHidden: () => void;
}

// One card component for both states: hiding an agent marks its card, it does
// not reshape it. A grid of half-height rows below a grid of full cards read as
// two different things, when the only difference is visibility.
const AgentCard: React.FC<AgentCardProps> = ({
    scenario,
    routable,
    loaded,
    hidden,
    onOpen,
    onToggleHidden,
}) => {
    const { t } = useTranslation();

    return (
        <Card
            variant="outlined"
            sx={{
                position: 'relative',
                boxShadow: 'none',
                opacity: hidden ? 0.55 : 1,
                transition: 'opacity 0.15s, border-color 0.15s, background-color 0.15s',
                // Reveal the visibility toggle on hover/focus so it stays
                // available (principle #10) without competing with the
                // scenario name for attention (principle #9). A hidden card
                // keeps it visible instead — there the toggle is the card's
                // state, and the state has to be readable without hovering.
                '&:hover .scenario-visibility-toggle, &:focus-within .scenario-visibility-toggle': {
                    opacity: 1,
                },
                '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
                },
            }}
        >
            {scenario.hideable && (
                <Tooltip
                    title={hidden
                        ? t('scenarioOverview.showInSidebar')
                        : t('scenarioOverview.hideFromSidebar', { defaultValue: 'Hide from sidebar' })}
                    arrow
                >
                    <IconButton
                        className="scenario-visibility-toggle"
                        size="small"
                        onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
                        sx={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            zIndex: 1,
                            color: 'text.disabled',
                            opacity: hidden ? 1 : 0,
                        }}
                    >
                        {hidden
                            ? <IconVisibilityOff fontSize="small" />
                            : <IconVisibility fontSize="small" />}
                    </IconButton>
                </Tooltip>
            )}
            <CardActionArea
                onClick={onOpen}
                sx={{ p: 1.5 }}
            >
                {/* Routing readiness sits under the name, beside the icon,
                    instead of on its own footer row — one row less
                    per card. The right padding on a hidden card keeps the
                    Hidden chip clear of the always-visible toggle. */}
                <Stack
                    direction="row"
                    spacing={1.25}
                    sx={{
                        alignItems: "center",
                        mb: 0.75,
                        pr: hidden ? 4 : 0,
                    }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, flexShrink: 0 }}>
                        {scenario.icon(scenarioIconSize)}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                                {t(scenario.labelKey)}
                            </Typography>
                            {hidden && (
                                <Chip
                                    size="small"
                                    label={t('scenarioOverview.hidden')}
                                    sx={{ height: 18, fontSize: '0.6875rem', flexShrink: 0 }}
                                />
                            )}
                        </Stack>
                        <Box sx={{ minHeight: 18, display: 'flex', alignItems: 'center' }}>
                            {!loaded ? (
                                <Skeleton variant="text" width={56} />
                            ) : routable === undefined ? null : routable ? (
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {t('agentHome.more.ready')}
                                </Typography>
                            ) : (
                                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                                    {t('agentHome.more.noService')}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </Stack>
                <Typography
                    variant="body2"
                    sx={{
                        color: "text.secondary",
                        minHeight: 40,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                    }}>
                    {t(scenario.descKey)}
                </Typography>
            </CardActionArea>
        </Card>
    );
};

// /agent — the landing page. Answers, in order: does anything need me; how
// is each agent I use doing (last request, where it went, is its client
// config current); and, folded away, which other agents exist. It replaced
// both the old card-grid launcher here and Dashboard › Overview: they listed
// the same agents with different halves of their state.
const ACTIVITY_DAYS = 7;
// Enough recent records to find the latest request of every agent in
// practice; request counts come from the aggregated stats, not from these.
const RECENT_RECORD_LIMIT = 500;

// Agents whose client config the gateway can read back and compare.
const CONFIG_TOOLS: Record<string, 'claude' | 'codex' | 'dsh'> = {
    claude_code: 'claude',
    codex: 'codex',
    dsh: 'dsh',
};

interface HomeData {
    providers: ProviderLike[];
    providersLoaded: boolean;
    quotas: Record<string, ProviderQuota | undefined>;
    activity: Record<string, AgentActivity>;
    rules: Record<string, RuleLike[] | undefined>;
    config: Record<string, ClientConfigStatus | undefined>;
}

async function loadHome(): Promise<HomeData> {
    const now = new Date();
    const since = new Date(now.getTime() - ACTIVITY_DAYS * 24 * 3600 * 1000);
    const range = { start_time: toLocalISOString(since), end_time: toLocalISOString(now) };
    const [providersRes, statsRes, recordsRes, ruleEntries, configEntries] = await Promise.all([
        api.getProviders().catch(() => undefined),
        api.getUsageStats({ group_by: 'scenario', ...range, limit: 1000 }).catch(() => undefined),
        api.getUsageRecords({ ...range, limit: RECENT_RECORD_LIMIT }).catch(() => undefined),
        Promise.all(SCENARIOS.map(async (s) => {
            try {
                const res = await api.getRules(s.id);
                return [s.id, Array.isArray(res?.data) ? res.data as RuleLike[] : []] as const;
            } catch {
                return [s.id, undefined] as const;
            }
        })),
        Promise.all(Object.entries(CONFIG_TOOLS).map(async ([id, tool]) => {
            const res = await controlApi((client, headers) => client.GET(`/api/v1/config/${tool}/status`, { headers }))
                .catch(() => undefined);
            return [id, res?.success ? res as ClientConfigStatus : undefined] as const;
        })),
    ]);

    const providersLoaded = Array.isArray(providersRes?.data);
    const providers: ProviderLike[] = providersLoaded ? providersRes.data : [];
    const enabled = providers.filter(p => p.enabled !== false).map(p => p.uuid);
    // Quota is best-effort here: the Credentials page owns reporting quota
    // failures, the home page just skips what it can't read.
    const quotas: Record<string, ProviderQuota | undefined> = enabled.length === 0 ? {} : await fetchUIAPI('/provider-quota/batch', {
        method: 'POST',
        body: JSON.stringify({ provider_uuids: enabled }),
    }).then(r => r?.data ?? {}).catch(() => ({}));

    return {
        providers,
        providersLoaded,
        quotas,
        activity: summarizeAgentActivity(
            Array.isArray(recordsRes?.data) ? recordsRes.data : [],
            Array.isArray(statsRes?.data) ? statsRes.data : [],
        ),
        rules: Object.fromEntries(ruleEntries),
        config: Object.fromEntries(configEntries),
    };
}

const AgentOverviewPage: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isHidden, toggleHidden } = useHiddenScenarios();
    const { isHealthy, checking, checkHealth } = useHealth();
    const { hasUpdate, showUpdateDialog } = useVersion();
    const [data, setData] = useState<HomeData | null>(null);
    const [moreOpen, setMoreOpen] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadHome().then(d => { if (!cancelled) setData(d); });
        return () => { cancelled = true; };
    }, []);

    const routable = (id: string) => {
        const rules = data?.rules[id];
        return rules === undefined ? undefined : hasRoutableService(rules);
    };
    const inUse = (id: string) => isAgentInUse(data?.activity[id], data?.config[id]?.state);
    const labelOf = (id: string) => {
        const s = SCENARIOS.find(x => x.id === id);
        return s ? t(s.labelKey) : id;
    };
    const pathOf = (id: string) => SCENARIOS.find(x => x.id === id)?.path ?? '/agent';

    // In use: most recently active first. Hidden-from-sidebar doesn't remove
    // an agent from here — hiding is a sidebar preference, activity is a fact.
    const used = useMemo(() => {
        if (!data) return [];
        const lastAt = (id: string) => {
            const at = data.activity[id]?.lastAt;
            return at ? new Date(at).getTime() : 0;
        };
        return SCENARIOS.filter(s => inUse(s.id)).sort((a, b) => lastAt(b.id) - lastAt(a.id));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);
    const usedIds = new Set(used.map(s => s.id));
    const moreVisible = SCENARIOS.filter(s => !usedIds.has(s.id) && !(s.hideable && isHidden(s.id)));
    const moreHidden = SCENARIOS.filter(s => !usedIds.has(s.id) && s.hideable && isHidden(s.id));
    // Nothing in use yet → the catalog is the next step, so it starts open.
    const moreExpanded = moreOpen ?? (data !== null && used.length === 0);

    const attention = useMemo(() => buildAttentionItems({
        healthy: isHealthy,
        hasUpdate,
        providers: data?.providers ?? [],
        providersLoaded: data?.providersLoaded,
        quotas: data?.quotas ?? {},
        agents: SCENARIOS.map(s => ({
            id: s.id,
            inUse: inUse(s.id),
            routable: routable(s.id),
            configState: data?.config[s.id]?.state,
            configDiffCount: data?.config[s.id]?.differences?.length,
        })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [isHealthy, hasUpdate, data]);

    const attentionRow = (item: AttentionItem, index: number) => {
        let icon = <WarningAmber sx={{ fontSize: 20 }} color="warning" />;
        let text = '';
        let action: React.ReactNode = null;
        switch (item.kind) {
            case 'disconnected':
                icon = <ErrorOutline sx={{ fontSize: 20 }} color="error" />;
                text = t('agentHome.attention.disconnected');
                action = <Button size="small" onClick={() => void checkHealth()} disabled={checking}>{t('health.retry')}</Button>;
                break;
            case 'noProvider':
                icon = <ErrorOutline sx={{ fontSize: 20 }} color="error" />;
                text = t('agentHome.attention.noProvider');
                action = <Button size="small" onClick={() => navigate('/credentials')}>{t('agentHome.attention.connectAI')}</Button>;
                break;
            case 'noService':
                icon = <ErrorOutline sx={{ fontSize: 20 }} color="error" />;
                text = t('agentHome.attention.noService', { agent: labelOf(item.agentId) });
                action = <Button size="small" onClick={() => navigate(pathOf(item.agentId))}>{t('agentHome.attention.openRules')}</Button>;
                break;
            case 'configOutdated':
                text = t('agentHome.attention.configOutdated', { agent: labelOf(item.agentId), diffs: item.count });
                action = <Button size="small" onClick={() => navigate(pathOf(item.agentId))}>{t('clientConfigStatus.reapply')}</Button>;
                break;
            case 'oauthExpired':
                icon = <ErrorOutline sx={{ fontSize: 20 }} color="error" />;
                text = t('agentHome.attention.oauthExpired', { provider: item.providerName });
                action = <Button size="small" onClick={() => navigate('/credentials')}>{t('agentHome.attention.openCredentials')}</Button>;
                break;
            case 'quotaLow':
                text = t('agentHome.attention.quotaLow', { provider: item.providerName, window: item.windowLabel, percent: item.percentLeft });
                action = <Button size="small" onClick={() => navigate('/credentials')}>{t('agentHome.attention.viewQuota')}</Button>;
                break;
            case 'update':
                icon = <UpgradeOutlined sx={{ fontSize: 20 }} color="info" />;
                text = t('agentHome.attention.update');
                action = <Button size="small" onClick={showUpdateDialog}>{t('agentHome.attention.viewUpdate')}</Button>;
                break;
        }
        return (
            <Stack key={index} direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 0.75, borderTop: index ? '1px solid' : 'none', borderColor: 'divider' }}>
                {icon}
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{text}</Typography>
                {action}
            </Stack>
        );
    };

    const agentRow = (s: ScenarioDescriptor, index: number) => {
        const a = data?.activity[s.id];
        const route = a?.model
            ? `${a.requestModel && a.requestModel !== a.model ? `${a.requestModel} → ` : ''}${a.model}${a.providerName ? ` · ${a.providerName}` : ''}`
            : '';
        const config = data?.config[s.id];
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
                <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{s.icon(22)}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t(s.labelKey)}</Typography>
                        {s.hideable && isHidden(s.id) && (
                            <Chip size="small" label={t('scenarioOverview.hidden')} sx={{ height: 18, fontSize: '0.6875rem' }} />
                        )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {a?.lastAt ? (
                            <>
                                {timeAgo(a.lastAt)}
                                {route && <Box component="span" sx={{ fontFamily: fontMono, ml: 1 }}>{route}</Box>}
                            </>
                        ) : t('agentHome.agents.noRecentRequests', { days: ACTIVITY_DAYS })}
                    </Typography>
                </Box>
                {routable(s.id) === false && (
                    <Typography variant="caption" sx={{ color: 'error.main', flexShrink: 0 }}>{t('agentHome.more.noService')}</Typography>
                )}
                {config && (
                    <Box onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
                        <ClientConfigStatusChip status={config} onApply={() => navigate(s.path)} />
                    </Box>
                )}
                {a && a.requestCount > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, minWidth: 88, textAlign: 'right' }}>
                        {t('agentHome.agents.requests', { count: a.requestCount })}
                    </Typography>
                )}
                <ArrowForward sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
            </Stack>
        );
    };

    const cardGrid = (list: ScenarioDescriptor[], hidden: boolean) => (
        <Grid container spacing={2}>
            {list.map((s) => (
                <Grid key={s.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                    <AgentCard
                        scenario={s}
                        routable={routable(s.id)}
                        loaded={data !== null}
                        hidden={hidden}
                        onOpen={() => navigate(s.path)}
                        onToggleHidden={() => toggleHidden(s.id)}
                    />
                </Grid>
            ))}
        </Grid>
    );

    return (
        <PageLayout loading={false}>
            <Box sx={{ maxWidth: pageContentMaxWidth, mx: 'auto' }}>
                <Stack spacing={3}>
                    <UnifiedCard
                        size="full"
                        titleHeadingLevel={1}
                        title={t('scenarioOverview.title')}
                        subtitle={t('agentHome.subtitle')}
                        rightAction={
                            <Button size="small" endIcon={<ArrowForward sx={{ fontSize: 16 }} />} onClick={() => navigate('/dashboard/today')}>
                                {t('agentHome.agents.viewUsage')}
                            </Button>
                        }
                    >
                        {/* Does anything need me? Absent when nothing does. */}
                        {attention.length > 0 && (
                            <Box sx={{ mb: 3, px: 2, py: 1, border: '1px solid', borderColor: 'warning.light', borderRadius: 2, bgcolor: (theme) => alpha(theme.palette.warning.main, 0.04) }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 600, pt: 0.5 }}>
                                    {t('agentHome.attention.titleCount', { n: attention.length })}
                                </Typography>
                                {attention.map(attentionRow)}
                            </Box>
                        )}

                        {/* How is each agent I use doing? */}
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {t('agentHome.agents.title')}
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                {t('agentHome.agents.subtitle', { days: ACTIVITY_DAYS })}
                            </Typography>
                        </Typography>
                        <Box sx={{ mt: 1, mb: 3 }}>
                            {data === null ? (
                                <Stack spacing={1}>{[0, 1, 2].map(i => <Skeleton key={i} variant="rounded" height={44} />)}</Stack>
                            ) : used.length === 0 ? (
                                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                                    {t('agentHome.agents.empty')}
                                </Typography>
                            ) : used.map(agentRow)}
                        </Box>

                        {/* Which other agents exist? Folded once something is in use. */}
                        <Button
                            size="small"
                            color="inherit"
                            onClick={() => setMoreOpen(!moreExpanded)}
                            startIcon={<ExpandMore sx={{ fontSize: 18, transition: 'transform 0.15s', transform: moreExpanded ? 'none' : 'rotate(-90deg)' }} />}
                            sx={{ fontWeight: 600, px: 1, ml: -1 }}
                        >
                            {t('agentHome.more.title', { n: moreVisible.length + moreHidden.length })}
                        </Button>
                        <Collapse in={moreExpanded} unmountOnExit>
                            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
                                {t('agentHome.more.subtitle')}
                            </Typography>
                            {cardGrid(moreVisible, false)}
                            {moreHidden.length > 0 && (
                                <Box sx={{ mt: 3 }}>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                        {t('scenarioOverview.hidden')} · {moreHidden.length}
                                    </Typography>
                                    <Box sx={{ mt: 0.5 }}>{cardGrid(moreHidden, true)}</Box>
                                </Box>
                            )}
                        </Collapse>
                    </UnifiedCard>

                    <PowerUpsSection />
                </Stack>
            </Box>
        </PageLayout>
    );
};

export default AgentOverviewPage;
