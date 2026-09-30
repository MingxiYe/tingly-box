import ClaudeDesktopConfigModal from './components/ClaudeDesktopConfigModal';
import { AgentPage, type AgentPageDescriptor } from './AgentPage';

const claudeDesktop: AgentPageDescriptor = {
    scenario: 'claude_desktop',
    title: 'Claude Desktop',
    tooltipKey: 'scenarioPage.tooltip.claude_desktop',
    connection: { compact: true, apiKeyRow: true, baseUrlRow: true },
    context1M: true,
    setup: {
        kind: 'guide',
        renderDialog: (slot) => (
            <ClaudeDesktopConfigModal
                open={slot.dialogOpen}
                onClose={slot.closeDialog}
                baseUrl={slot.baseUrl}
                copyToClipboard={slot.copyToClipboard}
                rules={slot.rules}
                onRulesRefresh={() => slot.loadRules(slot.scenario)}
                pendingContext1MChange={slot.pendingContext1MChange}
            />
        ),
    },
};

const UseClaudeDesktopPage: React.FC = () => <AgentPage agent={claudeDesktop} />;

export default UseClaudeDesktopPage;
