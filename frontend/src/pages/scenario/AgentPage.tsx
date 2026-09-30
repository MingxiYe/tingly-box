import { useState } from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ClientConfigTool } from '@/hooks/useClientConfigStatus';
import { ScenarioPageModalProvider } from '@/pages/scenario/context/ScenarioPageContext';
import { type SlotMode, useSlotRouting } from '@/pages/scenario/hooks/useSlotRouting';
import AgentSetupCard, {
    type AgentApplyResult,
    type AgentInstallAction,
    hasModelOnAnyRule,
    scrollToModelsCard,
} from './components/AgentSetupCard';
import { ScenarioConfigButton, ScenarioPage, type ScenarioPageSlot } from './ScenarioPage';

/**
 * How an agent's client gets pointed at the gateway. The header button's
 * label follows from it, not from the page (`.design/agent-page-redesign.md`
 * §3.3):
 * - `none`: nothing to configure on the client side (SDKs) — no button;
 * - `guide`: manual steps in a dialog — "Setup Guide";
 * - `auto`: the gateway writes the client's config files — "Auto Config".
 */
export type AgentSetup =
    | { kind: 'none' }
    | { kind: 'guide'; renderDialog: (slot: AgentPageSlot) => React.ReactNode }
    | {
        kind: 'auto';
        /** One-click apply with default settings (Quick Start, and dialogs that reuse it). */
        apply: (t: TFunction, ctx: AgentApplyContext) => Promise<AgentApplyResult>;
        /** Quick Start's second apply button, which also installs the status line (Claude Code). */
        applyWithStatusLine?: (t: TFunction, ctx: AgentApplyContext) => Promise<AgentApplyResult>;
        renderDialog: (slot: AgentPageSlot) => React.ReactNode;
    };

/** What a one-click apply derives its settings from. */
export interface AgentApplyContext {
    rules: any[];
    /** Set for agents with slot routing. */
    slotMode?: SlotMode;
}

/** The Quick Start card: install → configure → pick a model. */
export interface AgentQuickStart {
    /** Shown as a copyable command; empty when installing is not a command. */
    installCommand?: string;
    installMirrorCommand?: string;
    installDescriptionKey?: string;
    installActions?: (t: TFunction) => AgentInstallAction[];
    applyStepLabelKey?: string;
    applyStepDescriptionKey?: string;
    /** Label of the step's button that opens the setup dialog. */
    openDialogLabelKey?: string;
}

/** A link next to the header's config button (e.g. DSH's local Web UI). */
export interface AgentHeaderLink {
    labelKey: string;
    href: string;
}

/**
 * Everything that differs between agent pages, as data. One `AgentPage`
 * renders any of them: header (name, config status, links, config button) →
 * connection rows → Quick Start → routing rules → setup dialog.
 */
export interface AgentPageDescriptor {
    scenario: string;
    /** Product name; not translated. */
    title: string;
    tooltipKey?: string;
    connection?: {
        /** Title of the connection rows when it differs from `title`. */
        titleKey?: string;
        compact?: boolean;
        apiKeyRow?: boolean;
        baseUrlRow?: boolean;
    };
    /** The gateway can read this client's config back: show whether it is applied. */
    clientConfigTool?: ClientConfigTool;
    /** Rules offer the 1M-context toggle; toggling opens the setup dialog. */
    context1M?: boolean;
    setup: AgentSetup;
    quickStart?: AgentQuickStart;
    headerLinks?: AgentHeaderLink[];
    /** Title of the routing rules card when it is not the default. */
    rulesTitleKey?: string;
    /**
     * Fixed model slots (Claude Code): a Unified / Separate switch in the
     * header decides which rules are shown; rules can't be added, removed or
     * switched off, since each one backs a slot.
     */
    slotRouting?: { unifiedRuleUuid: string };
}

export interface AgentPageSlot extends ScenarioPageSlot {
    /** `setup.apply` with its loading state tracked. */
    apply: () => Promise<AgentApplyResult>;
    /** Run another apply (e.g. a dialog's, with its own settings) under the same loading state. */
    runApply: (apply: () => Promise<AgentApplyResult>) => Promise<AgentApplyResult>;
    isApplyLoading: boolean;
    slotMode?: SlotMode;
    /** Close the setup dialog and drop a pending 1M-context change. */
    closeDialog: () => void;
}

const AgentPageContent: React.FC<{ agent: AgentPageDescriptor }> = ({ agent }) => {
    const { t } = useTranslation();
    const [isApplyLoading, setIsApplyLoading] = useState(false);
    const { setup, quickStart, headerLinks } = agent;
    const slots = useSlotRouting(agent.scenario, agent.slotRouting?.unifiedRuleUuid ?? '', !!agent.slotRouting);
    const slotMode = agent.slotRouting ? slots.mode : undefined;

    const runApply = async (apply: () => Promise<AgentApplyResult>) => {
        setIsApplyLoading(true);
        try {
            return await apply();
        } finally {
            setIsApplyLoading(false);
        }
    };

    const toAgentSlot = (slot: ScenarioPageSlot): AgentPageSlot => ({
        ...slot,
        isApplyLoading,
        slotMode,
        runApply,
        apply: () => (setup.kind === 'auto'
            ? runApply(() => setup.apply(t, { rules: slot.rules, slotMode }))
            : Promise.resolve({ success: false })),
        closeDialog: () => {
            slot.closeConfigModal();
            slot.clearPendingContext1MChange();
        },
    });

    const configButton = (slot: ScenarioPageSlot) => setup.kind !== 'none' && (
        <ScenarioConfigButton
            onClick={slot.openConfigModal}
            label={t(setup.kind === 'auto' ? 'scenarioPage.autoConfig' : 'scenarioPage.setupGuide')}
            // A header link takes the primary style; the config button steps back.
            variant={headerLinks?.length ? 'outlined' : 'contained'}
        />
    );

    return (
        <ScenarioPage
            scenario={agent.scenario}
            title={agent.title}
            tooltipKey={agent.tooltipKey}
            clientConfigTool={agent.clientConfigTool}
            providerCard={{
                title: agent.connection?.titleKey ? t(agent.connection.titleKey) : undefined,
                compact: agent.connection?.compact,
                showApiKeyRow: agent.connection?.apiKeyRow,
                showBaseUrlRow: agent.connection?.baseUrlRow,
            }}
            templateTitle={agent.rulesTitleKey ? t(agent.rulesTitleKey) : undefined}
            context1M={agent.context1M}
            withConnectAI={!!quickStart}
            rulesSource={agent.slotRouting ? slots : undefined}
            ruleActions={agent.slotRouting ? { add: false, toggle: false, delete: false } : undefined}
            clientConfigStatusDeps={[slotMode]}
            renderRightAction={(slot) => (agent.slotRouting ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {slots.modeSwitch}
                    {configButton(slot)}
                </Box>
            ) : headerLinks?.length ? (
                <Box sx={{ display: 'flex', gap: 1 }}>
                    {headerLinks.map(link => (
                        <Tooltip key={link.href} title={link.href}>
                            <Button href={link.href} target="_blank" rel="noopener noreferrer" variant="contained" size="small">
                                {t(link.labelKey)}
                            </Button>
                        </Tooltip>
                    ))}
                    {configButton(slot)}
                </Box>
            ) : configButton(slot))}
            renderConfigModal={setup.kind === 'none' ? undefined : (slot) => (
                <>
                    {agent.slotRouting && slots.modeDialog}
                    {setup.renderDialog(toAgentSlot(slot))}
                </>
            )}
        >
            {quickStart && ((slot) => {
                const agentSlot = toAgentSlot(slot);
                return (
                    <AgentSetupCard
                        agentKey={agent.scenario}
                        agentName={agent.title}
                        installCommand={quickStart.installCommand ?? ''}
                        installMirrorCommand={quickStart.installMirrorCommand}
                        installStepDescription={quickStart.installDescriptionKey && t(quickStart.installDescriptionKey)}
                        installActions={quickStart.installActions?.(t)}
                        onApply={setup.kind === 'auto' ? agentSlot.apply : undefined}
                        onApplyWithStatusLine={setup.kind === 'auto' && setup.applyWithStatusLine
                            ? () => runApply(() => setup.applyWithStatusLine!(t, { rules: slot.rules, slotMode }))
                            : undefined}
                        isApplyLoading={isApplyLoading}
                        onViewConfig={slot.openConfigModal}
                        applyStepLabel={quickStart.applyStepLabelKey && t(quickStart.applyStepLabelKey)}
                        applyStepDescription={quickStart.applyStepDescriptionKey && t(quickStart.applyStepDescriptionKey)}
                        viewConfigButtonLabel={quickStart.openDialogLabelKey && t(quickStart.openDialogLabelKey)}
                        hasModelSelected={hasModelOnAnyRule(slot.rules)}
                        onSelectModel={scrollToModelsCard}
                        onConnectProvider={slot.connectAI.handleConnectAIClick}
                    />
                );
            })}
        </ScenarioPage>
    );
};

/** An agent page (`/agent/<scenario>`) rendered from its descriptor. */
export const AgentPage: React.FC<{ agent: AgentPageDescriptor }> = ({ agent }) => (
    <ScenarioPageModalProvider>
        <AgentPageContent agent={agent} />
    </ScenarioPageModalProvider>
);
