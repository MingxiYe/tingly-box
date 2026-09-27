import './styles.css';
import { AGENTS, CHANNELS, PROVIDERS } from './data/brands';
import { mountFlow } from './flow/stage';
import { startHero } from './hero/hero';
import { mountCopyButtons } from './ui/copy';
import { mountIcons } from './ui/icons';
import { renderCounts, renderLogos } from './ui/logos';
import { mountNavHighlight } from './ui/nav';
import { mountReveal } from './ui/reveal';
import { mountTabs } from './ui/tabs';

mountIcons();
renderLogos('logos-agents', AGENTS, { more: 'Any OpenAI / Anthropic client' });
renderLogos('logos-providers', PROVIDERS, { more: 'Any compatible endpoint' });
renderLogos('logos-im', CHANNELS, { labelled: false });
renderCounts({ agents: AGENTS.length, providers: PROVIDERS.length });
mountTabs();
mountCopyButtons();
mountNavHighlight();
mountReveal('.section-head, .feature, .frame, .team-steps li, .brand-group, .doc-links a, .next-steps li');

const hero = document.querySelector<HTMLCanvasElement>('#hero-canvas');
if (hero) {
  startHero(hero, {
    caption: document.getElementById('hero-level'),
    textColumn: document.querySelector<HTMLElement>('.hero-copy'),
    tooltip: document.getElementById('hero-tip'),
  });
}

const flowSvg = document.querySelector<SVGSVGElement>('#flow-svg');
const flowScroll = document.querySelector<HTMLElement>('.flow-scroll');
if (flowSvg && flowScroll) mountFlow(flowSvg, flowScroll);
