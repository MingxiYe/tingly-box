import { useState } from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ClientConfigTool } from '@/hooks/useClientConfigStatus';
import { ScenarioPageModalProvider } from '@/pages/scenario/context/ScenarioPageContext';
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
        apply: (t: TFunction) => Promise<AgentApplyResult>;
        renderDialog: (slot: AgentPageSlot) => React.ReactNode;
    };

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
}

export interface AgentPageSlot extends ScenarioPageSlot {
    /** `setup.apply` with its loading state tracked. */
    apply: () => Promise<AgentApplyResult>;
    isApplyLoading: boolean;
    /** Close the setup dialog and drop a pending 1M-context change. */
    closeDialog: () => void;
}

const AgentPageContent: React.FC<{ agent: AgentPageDescriptor }> = ({ agent }) => {
    const { t } = useTranslation();
    const [isApplyLoading, setIsApplyLoading] = useState(false);
    const { setup, quickStart, headerLinks } = agent;

    const toAgentSlot = (slot: ScenarioPageSlot): AgentPageSlot => ({
        ...slot,
        isApplyLoading,
        apply: async () => {
            if (setup.kind !== 'auto') return { success: false };
            setIsApplyLoading(true);
            try {
                return await setup.apply(t);
            } finally {
                setIsApplyLoading(false);
            }
        },
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
            renderRightAction={(slot) => (headerLinks?.length ? (
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
            renderConfigModal={setup.kind === 'none' ? undefined : (slot) => setup.renderDialog(toAgentSlot(slot))}
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
