import XcodeConfigModal from './components/XcodeConfigModal';
import { AgentPage, type AgentPageDescriptor } from './AgentPage';

const xcode: AgentPageDescriptor = {
    scenario: 'xcode',
    title: 'Xcode',
    tooltipKey: 'scenarioPage.tooltip.xcode',
    connection: { compact: true, apiKeyRow: true, baseUrlRow: true },
    setup: {
        kind: 'guide',
        renderDialog: (slot) => (
            <XcodeConfigModal
                open={slot.configModalOpen}
                onClose={slot.closeDialog}
                baseUrl={slot.baseUrl}
                copyToClipboard={slot.copyToClipboard}
            />
        ),
    },
};

const UseXcodePage: React.FC = () => <AgentPage agent={xcode} />;

export default UseXcodePage;
