import './styles.css';
import { AGENTS, CHANNELS, PROVIDERS } from './data/brands';
import { mountFlow } from './flow/stage';
import { startHero } from './hero/hero';
import { mountCopyButtons } from './ui/copy';
import { renderLogos } from './ui/logos';
import { mountReveal } from './ui/reveal';
import { mountTabs } from './ui/tabs';

renderLogos('logos-agents', AGENTS);
renderLogos('logos-providers', PROVIDERS);
renderLogos('logos-im', CHANNELS, false);
mountTabs();
mountCopyButtons();
mountReveal('.section-head, .feature, .shot, .team-steps li, .logo-row, .doc-links a, .strip-inner > div');

const hero = document.querySelector<HTMLCanvasElement>('#hero-canvas');
if (hero) startHero(hero, document.getElementById('hero-level'), document.querySelector<HTMLElement>('.hero-copy'));

const flowSvg = document.querySelector<SVGSVGElement>('#flow-svg');
const flowScroll = document.querySelector<HTMLElement>('.flow-scroll');
if (flowSvg && flowScroll) mountFlow(flowSvg, flowScroll);
