import CursorConfigModal from './components/CursorConfigModal';
import { AgentPage, type AgentPageDescriptor } from './AgentPage';

const cursor: AgentPageDescriptor = {
    scenario: 'cursor',
    title: 'Cursor',
    tooltipKey: 'scenarioPage.tooltip.cursor',
    connection: { compact: true, apiKeyRow: true, baseUrlRow: true },
    setup: {
        kind: 'guide',
        renderDialog: (slot) => (
            <CursorConfigModal
                open={slot.configModalOpen}
                onClose={slot.closeDialog}
                baseUrl={slot.baseUrl}
                copyToClipboard={slot.copyToClipboard}
            />
        ),
    },
};

const UseCursorPage: React.FC = () => <AgentPage agent={cursor} />;

export default UseCursorPage;
