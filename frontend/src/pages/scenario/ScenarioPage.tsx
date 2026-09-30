import { useState } from 'react';
import { Box, Button, IconButton, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Info as InfoIcon } from '@/components/icons';
import { ClientConfigStatusChip } from '@/components/ClientConfigStatusChip';
import { useClientConfigStatus, type ClientConfigTool } from '@/hooks/useClientConfigStatus';
import CardGrid from '@/components/CardGrid.tsx';
import ConnectAIDialogs from '@/components/ConnectAIDialogs';
import PageLayout from '@/components/PageLayout';
import ProviderConfigCard from '@/components/ProviderConfigCard.tsx';
import UnifiedCard from '@/components/UnifiedCard.tsx';
import { useProviderDialog } from '@/hooks/useProviderDialog';
import { useContext1MToggle } from '@/pages/scenario/hooks/useContext1MToggle';
import { useScenarioPageInternal } from '@/pages/scenario/hooks/useScenarioPageInternal.ts';
import ScenarioPageSkeleton from './components/ScenarioPageSkeleton';
import TemplatePage from './components/TemplatePage.tsx';

/**
 * Deliberate total-width cap for the header card's rows (Start/Base URL/API
 * Key/Plugins ConfigRows): on wide screens the card stays full-width but its
 * content stops at this value so the row actions don't drift far from the
 * row content — keeps every use page's header visually consistent.
 */
export const SCENARIO_HEADER_CONTENT_MAX_WIDTH = 960;

const NO_DEPS: unknown[] = [];

/**
 * UnifiedCard header title block shared by every scenario page: the card
 * title plus an optional i18n-keyed info tooltip. Pages that keep their own
 * structure (Codex, ImageGen) reuse this instead of re-rolling the Box.
 */
export const ScenarioCardHeader: React.FC<{ title: string; tooltipKey?: string; addon?: React.ReactNode }> = ({ title, tooltipKey, addon }) => {
    const { t } = useTranslation();
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <span>{title}</span>
            {tooltipKey && (
                <Tooltip title={t(tooltipKey)}>
                    <IconButton size="small" sx={{ ml: 0.5 }}>
                        <InfoIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    </IconButton>
                </Tooltip>
            )}
            {addon && <Box sx={{ ml: 0.5 }}>{addon}</Box>}
        </Box>
    );
};

/** Standard "Config" / "Auto Config" button in the UnifiedCard rightAction slot. */
export const ScenarioConfigButton: React.FC<{
    onClick: () => void;
    label: React.ReactNode;
    variant?: 'contained' | 'outlined';
}> = ({ onClick, label, variant = 'contained' }) => (
    <Button onClick={onClick} variant={variant} size="small">
        {label}
    </Button>
);

/**
 * Everything a scenario page's bespoke pieces (rightAction, extra cards,
 * config modal) may need from the shared skeleton.
 */
export interface ScenarioPageSlot {
    scenario: string;
    isLoading: boolean;
    baseUrl: string;
    copyToClipboard: (text: string, label: string) => Promise<void>;
    showNotification: ReturnType<typeof useScenarioPageInternal>['showNotification'];
    rules: any[];
    loadRules: (scenario: string) => Promise<void>;
    configModalOpen: boolean;
    openConfigModal: () => void;
    closeConfigModal: () => void;
    /** Set by the context-1M toggle; cleared via clearPendingContext1MChange when the modal closes. */
    pendingContext1MChange: boolean | null;
    /** The rule whose 1M toggle set pendingContext1MChange. */
    pendingContext1MRuleUuid?: string;
    clearPendingContext1MChange: () => void;
    connectAI: ReturnType<typeof useProviderDialog>;
}

export interface ScenarioPageProps {
    scenario: string;
    /** UnifiedCard title text (also the default ProviderConfigCard title). */
    title: string;
    /** i18n key for the info tooltip next to the title. */
    tooltipKey?: string;
    /** Show the client-config status chip for a tool whose config the gateway can read back. */
    clientConfigTool?: ClientConfigTool;
    /** UnifiedCard rightAction slot (static node). */
    rightAction?: React.ReactNode;
    /**
     * UnifiedCard rightAction slot when it needs page internals (config modal
     * open state, Connect AI flow, ...). Named `render*` — a function prop
     * returning JSX — so it reads as a render prop.
     */
    renderRightAction?: (slot: ScenarioPageSlot) => React.ReactNode;
    /** ProviderConfigCard overrides (title defaults to `title`). */
    providerCard?: {
        title?: string;
        compact?: boolean;
        showApiKeyRow?: boolean;
        showBaseUrlRow?: boolean;
    };
    /** Optional title override for the TemplatePage rules card. */
    templateTitle?: React.ReactNode;
    /** Wire TemplatePage's onContext1MToggle to the shared pending-change plumbing. */
    context1M?: boolean;
    /** Render <ConnectAIDialogs> for the shared Connect AI add flow. */
    withConnectAI?: boolean;
    /** Extra cards between the UnifiedCard and TemplatePage (e.g. AgentSetupCard). */
    children?: React.ReactNode | ((slot: ScenarioPageSlot) => React.ReactNode);
    /** Config modal rendered after TemplatePage; owns nothing — read open state from the slot. */
    renderConfigModal?: (slot: ScenarioPageSlot) => React.ReactNode;
    /**
     * Rules owned by the caller instead of loaded for the scenario (Claude
     * Code shows a different set per slot mode).
     */
    rulesSource?: { rules: any[]; setRules: (rules: any[]) => void; loading: boolean };
    /** What the rule list lets the user do; rules can be deleted by default. */
    ruleActions?: { add?: boolean; toggle?: boolean; delete?: boolean };
    /** More values that should trigger a client-config status re-read. */
    clientConfigStatusDeps?: unknown[];
}

/**
 * Shared scenario page skeleton: ScenarioPageModalProvider + useScenarioPageInternal
 * + PageLayout(ScenarioPageSkeleton) + CardGrid[UnifiedCard → extra cards →
 * TemplatePage → config modal → ConnectAIDialogs].
 *
 * Trivial pages reduce to pure props; pages with bespoke pieces (custom apply
 * flows, extra cards) pass them via the render-prop slots. Genuinely bespoke
 * pages (Claude Code, Team) keep their own structure.
 */
export const ScenarioPage: React.FC<ScenarioPageProps> = ({
    scenario,
    title,
    tooltipKey,
    clientConfigTool,
    rightAction,
    renderRightAction,
    providerCard,
    templateTitle,
    context1M = false,
    withConnectAI = false,
    children,
    renderConfigModal,
    rulesSource,
    ruleActions,
    clientConfigStatusDeps = NO_DEPS,
}) => {
    const internal = useScenarioPageInternal(scenario, { skipRules: rulesSource !== undefined });
    const { notification, showNotification, copyToClipboard, baseUrl, loadRules } = internal;
    const isLoading = internal.isLoading || (rulesSource?.loading ?? false);
    const rules = rulesSource ? rulesSource.rules : internal.rules;

    const [configModalOpen, setConfigModalOpen] = useState(false);
    const { status: clientConfigStatus } = useClientConfigStatus(clientConfigTool ?? null, [rules, configModalOpen, ...clientConfigStatusDeps]);
    // Context-1M toggle plumbing for pages whose TemplatePage wires it up.
    const context1MState = useContext1MToggle(() => setConfigModalOpen(true));
    // Unified Connect AI add flow (picker + form/OAuth/paste/import dialogs).
    const connectAI = useProviderDialog(showNotification, {
        onProviderAdded: () => window.location.reload(),
    });

    const slot: ScenarioPageSlot = {
        scenario,
        isLoading,
        baseUrl,
        copyToClipboard,
        showNotification,
        rules,
        loadRules,
        configModalOpen,
        openConfigModal: () => setConfigModalOpen(true),
        closeConfigModal: () => setConfigModalOpen(false),
        pendingContext1MChange: context1MState.pendingContext1MChange,
        pendingContext1MRuleUuid: context1MState.pendingContext1MRuleUuid,
        clearPendingContext1MChange: context1MState.clearPendingContext1MChange,
        connectAI,
    };

    return (
        <PageLayout loading={isLoading} loadingContent={<ScenarioPageSkeleton />} notification={notification}>
            <CardGrid>
                <UnifiedCard
                    titleHeadingLevel={1}
                    title={
                        <ScenarioCardHeader
                            title={title}
                            tooltipKey={tooltipKey}
                            addon={clientConfigTool && <ClientConfigStatusChip status={clientConfigStatus} onApply={() => setConfigModalOpen(true)} />}
                        />
                    }
                    size="full"
                    contentMaxWidth={SCENARIO_HEADER_CONTENT_MAX_WIDTH}
                    rightAction={renderRightAction ? renderRightAction(slot) : rightAction}
                >
                    <ProviderConfigCard
                        title={providerCard?.title ?? title}
                        baseUrlPath={`/tingly/${scenario}`}
                        baseUrl={baseUrl}
                        onCopy={copyToClipboard}
                        scenario={scenario}
                        compact={providerCard?.compact}
                        showApiKeyRow={providerCard?.showApiKeyRow}
                        showBaseUrlRow={providerCard?.showBaseUrlRow}
                    />
                </UnifiedCard>
                {typeof children === 'function' ? children(slot) : children}
                <TemplatePage
                    scenario={scenario}
                    // One copy of the rules for the whole page: the rule list
                    // and the config dialogs (slot.rules) read and reload the same state.
                    rules={rules}
                    {...(rulesSource
                        ? { onRulesChange: rulesSource.setRules }
                        : {
                            loadRules,
                            onRulesChange: internal.handleRulesChange,
                            onRuleDelete: internal.handleRuleDelete,
                            newlyCreatedRuleUuids: internal.newlyCreatedRuleUuids,
                        })}
                    {...(templateTitle !== undefined ? { title: templateTitle } : {})}
                    collapsible={true}
                    allowDeleteRule={ruleActions?.delete ?? true}
                    {...(ruleActions?.add !== undefined ? { allowAddRule: ruleActions.add } : {})}
                    {...(ruleActions?.toggle !== undefined ? { allowToggleRule: ruleActions.toggle } : {})}
                    {...(context1M ? { onContext1MToggle: context1MState.handleContext1MToggle } : {})}
                />
                {renderConfigModal?.(slot)}
                {withConnectAI && <ConnectAIDialogs flow={connectAI} />}
            </CardGrid>
        </PageLayout>
    );
};
