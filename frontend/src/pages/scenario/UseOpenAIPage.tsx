import { AgentPage, type AgentPageDescriptor } from './AgentPage';

const openai: AgentPageDescriptor = {
    scenario: 'openai',
    title: 'OpenAI SDK',
    setup: { kind: 'none' },
};

const UseOpenAIPage: React.FC = () => <AgentPage agent={openai} />;

export default UseOpenAIPage;
