// "How it works": a sticky SVG stage driven by scroll. Each step reveals its
// pieces (cards pop in, edges draw along their length) while the camera — the
// SVG viewBox — pans from the agents out to the whole team picture.
// Narrow screens and reduced motion get the complete picture, statically.
import { byName, AGENTS, CHANNELS, PROVIDERS } from '../data/brands';

type Item =
  | { kind: 'edge'; el: SVGGElement; step: number; order: number }
  | { kind: 'pop'; el: SVGGElement; step: number; order: number; origin: [number, number] };

const NS = 'http://www.w3.org/2000/svg';
const STEPS = 5;
const STEP_GAP = 0.9;
const STEP_ANIM = 0.7;

// camera stop per step: x, y, w, h in viewBox units
const CAMERA: number[][] = [
  [-20, 140, 560, 358],
  [30, 120, 660, 422],
  [40, 110, 920, 520],
  [30, 30, 940, 560],
  [0, 20, 1000, 620],
];
const FULL = [0, 20, 1000, 620];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const backOut = (t: number): number => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

export function mountFlow(svg: SVGSVGElement, scroller: HTMLElement): void {
  const items: Item[] = [];

  function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = svg): SVGElementTagNameMap[K] {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    parent.append(n);
    return n;
  }
  function text(parent: Element, x: number, y: number, cls: string, value: string, attrs: Record<string, string | number> = {}): void {
    el('text', { x, y, class: cls, ...attrs }, parent).textContent = value;
  }
  function pop(step: number, order: number, origin: [number, number]): SVGGElement {
    const g = el('g', {});
    items.push({ kind: 'pop', el: g, step, order, origin });
    return g;
  }
  function edge(step: number, order: number, d: string): void {
    const g = el('g', {});
    el('path', { d, class: 'fl-edge', pathLength: 1 }, g);
    el('path', { d, class: 'fl-flow', pathLength: 1 }, g);
    items.push({ kind: 'edge', el: g, step, order });
  }
  function iconCard(parent: Element, x: number, y: number, icon: string, size = 40): void {
    el('rect', { x: x - size / 2, y: y - size / 2, width: size, height: size, rx: size * 0.26, fill: '#fff', stroke: 'rgba(22,24,29,0.14)' }, parent);
    el('image', { href: icon, x: x - size * 0.29, y: y - size * 0.29, width: size * 0.58, height: size * 0.58 }, parent);
  }
  function card(step: number, order: number, cx: number, title: string): SVGGElement {
    const g = pop(step, order, [cx, 575]);
    el('rect', { x: cx - 75, y: 544, width: 150, height: 62, rx: 12, class: 'fl-card' }, g);
    text(g, cx - 61, 566, 'fl-title', title);
    return g;
  }

  const BOX = { x: 500, y: 330, s: 136 };
  const agents = ['Claude Code', 'Codex', 'OpenCode', 'Cursor', 'Xcode'].map((n) => byName(AGENTS, n));
  const providers = ['Anthropic', 'OpenAI', 'Gemini', 'DeepSeek', 'Qwen', 'Ollama'].map((n) => byName(PROVIDERS, n));
  const members = ['AL', 'BK', 'CS', 'DM'];
  const bottom = [260, 420, 580, 740];
  const agentY = (i: number): number => 206 + i * 62;
  const provY = (i: number): number => 188 + i * 56;
  const memberX = (i: number): number => 380 + i * 80;

  // edges first so cards sit on top of them
  agents.forEach((_, i) => edge(1, i, `M 236 ${agentY(i)} C 330 ${agentY(i)}, 340 ${BOX.y}, ${BOX.x - BOX.s / 2 - 6} ${BOX.y}`));
  providers.forEach((_, i) => edge(2, i, `M ${BOX.x + BOX.s / 2 + 6} ${BOX.y} C 670 ${BOX.y}, 690 ${provY(i)}, 776 ${provY(i)}`));
  members.forEach((_, i) => edge(3, i, `M ${memberX(i)} 126 C ${memberX(i)} 170, 500 160, 500 ${BOX.y - BOX.s / 2 - 40}`));
  bottom.forEach((x, i) => edge(4, i, `M 500 ${BOX.y + BOX.s / 2 + 64} C 500 520, ${x} 510, ${x} 540`));

  // 01 — agents
  agents.forEach((a, i) => {
    const g = pop(0, i, [110, agentY(i)]);
    iconCard(g, 110, agentY(i), a.icon);
    text(g, 142, agentY(i) + 5, 'fl-label', a.name);
  });

  // 02 — the box and its endpoint
  {
    const g = pop(1, 0, [BOX.x, BOX.y]);
    el('rect', { x: BOX.x - BOX.s / 2, y: BOX.y - BOX.s / 2, width: BOX.s, height: BOX.s, rx: BOX.s * 0.28, class: 'fl-brand' }, g);
    text(g, BOX.x, BOX.y + 24, 'fl-brand-t', 'T', { 'text-anchor': 'middle' });
    const e = pop(1, 2, [BOX.x, BOX.y - BOX.s / 2 - 27]);
    el('rect', { x: BOX.x - 118, y: BOX.y - BOX.s / 2 - 40, width: 236, height: 26, rx: 13, class: 'fl-accent-soft' }, e);
    text(e, BOX.x, BOX.y - BOX.s / 2 - 23, 'fl-accent-text', 'localhost:12580/tingly/…', { 'text-anchor': 'middle' });
  }

  // 03 — providers, a routing rule, protocol translation
  providers.forEach((p, i) => {
    const g = pop(2, i + 1, [800, provY(i)]);
    iconCard(g, 800, provY(i), p.icon, 36);
    text(g, 828, provY(i) + 5, 'fl-label', p.name);
  });
  {
    const g = pop(2, 0, [BOX.x, BOX.y + BOX.s / 2 + 38]);
    el('rect', { x: BOX.x - 150, y: BOX.y + BOX.s / 2 + 14, width: 300, height: 48, rx: 12, class: 'fl-card' }, g);
    text(g, BOX.x - 134, BOX.y + BOX.s / 2 + 34, 'fl-mono', 'rule  claude-sonnet');
    text(g, BOX.x - 134, BOX.y + BOX.s / 2 + 52, 'fl-label', '→ Anthropic · fallback DeepSeek');
    const p = pop(2, 3, [745, 149]);
    el('rect', { x: 660, y: 136, width: 170, height: 26, rx: 13, class: 'fl-soft' }, p);
    text(p, 745, 153, 'fl-mono', 'Anthropic ⇄ OpenAI ⇄ Gemini', { 'text-anchor': 'middle' });
  }

  // 04 — team members, one sharing key each
  members.forEach((initials, i) => {
    const x = memberX(i);
    const g = pop(3, i, [x, 96]);
    el('circle', { cx: x, cy: 88, r: 22, class: 'fl-soft' }, g);
    text(g, x, 93, 'fl-title', initials, { 'text-anchor': 'middle' });
    el('rect', { x: x - 30, y: 114, width: 60, height: 18, rx: 9, class: 'fl-card' }, g);
    text(g, x, 127, 'fl-mono fl-small', `sk-••${i + 3}f`, { 'text-anchor': 'middle' });
  });
  {
    const g = pop(3, 5, [220, 88]);
    text(g, 300, 80, 'fl-title', 'Your team', { 'text-anchor': 'end' });
    text(g, 300, 98, 'fl-mono', 'one key each', { 'text-anchor': 'end' });
  }

  // 05 — govern, extend & observe
  {
    const g = card(4, 0, bottom[0], 'Guardrails');
    el('path', { d: `M ${bottom[0] - 60} 578 l 9 -3 l 9 3 v 7 c 0 6 -4 10 -9 11 c -5 -1 -9 -5 -9 -11 z`, class: 'fl-accent' }, g);
    text(g, bottom[0] - 36, 592, 'fl-mono fl-small', 'keys masked');
  }
  {
    const g = card(4, 1, bottom[1], 'MCP tools');
    ['web_search', 'fs', '+ yours'].forEach((t, i) => {
      const x = bottom[1] - 61 + [0, 66, 90][i];
      el('rect', { x, y: 578, width: [62, 20, 38][i], height: 16, rx: 8, class: i === 0 ? 'fl-accent-soft' : 'fl-soft' }, g);
      text(g, x + [31, 10, 19][i], 590, 'fl-mono fl-small', t, { 'text-anchor': 'middle' });
    });
  }
  {
    const g = card(4, 2, bottom[2], 'Usage');
    [14, 22, 12, 28, 20, 32, 24].forEach((h, i) => {
      el('rect', { x: bottom[2] - 61 + i * 17, y: 598 - h * 0.6, width: 10, height: h * 0.6, rx: 2, class: i === 5 ? 'fl-accent' : 'fl-soft' }, g);
    });
  }
  {
    const g = card(4, 3, bottom[3], 'Remote');
    ['Telegram', 'Weixin', 'Feishu / Lark', 'DingTalk'].forEach((n, i) => iconCard(g, bottom[3] - 49 + i * 30, 588, byName(CHANNELS, n).icon, 24));
  }

  const steps = [...document.querySelectorAll<HTMLElement>('.flow-step')];

  function render(t: number, dynamic: boolean): void {
    const reveal = Array.from({ length: STEPS }, (_, k) => (dynamic ? clamp01((t - k * STEP_GAP) / STEP_ANIM) : 1));
    for (const it of items) {
      const local = dynamic ? clamp01((reveal[it.step] * STEP_ANIM - it.order * 0.05) / (STEP_ANIM * 0.55)) : 1;
      if (it.kind === 'edge') {
        it.el.style.opacity = local > 0 ? '1' : '0';
        (it.el.firstChild as SVGPathElement).style.strokeDashoffset = String(1 - local);
        (it.el.lastChild as SVGPathElement).style.opacity = local >= 1 ? '1' : '0';
      } else {
        const s = local <= 0 ? 0 : backOut(local);
        const [ox, oy] = it.origin;
        it.el.style.opacity = String(Math.min(1, local * 2));
        it.el.setAttribute('transform', `translate(${ox} ${oy}) scale(${s}) translate(${-ox} ${-oy})`);
      }
    }

    let box = FULL;
    if (dynamic) {
      const c = reveal.slice(1).reduce((a, v) => a + ease(v), 0);
      const i = Math.min(CAMERA.length - 2, Math.floor(c));
      const f = c - i;
      box = CAMERA[i].map((v, j) => v + (CAMERA[i + 1][j] - v) * f);
    }
    svg.setAttribute('viewBox', box.map((v) => v.toFixed(2)).join(' '));

    let active = 0;
    for (let k = 0; k < STEPS; k++) if (t >= k * STEP_GAP) active = k;
    steps.forEach((s, k) => {
      s.dataset.state = !dynamic ? 'static' : k === active ? 'active' : k < active ? 'done' : 'upcoming';
    });
  }

  const wide = window.matchMedia('(min-width: 992px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let dynamic = false, near = false, target = 0, current = 0, raf = 0;

  function measure(): void {
    const rect = scroller.getBoundingClientRect();
    const span = rect.height - window.innerHeight;
    const p = span > 0 ? clamp01(-rect.top / span) : 1;
    target = 0.5 + p * ((STEPS - 1) * STEP_GAP + STEP_ANIM - 0.3);
  }
  function loop(): void {
    raf = 0;
    const d = target - current;
    current = Math.abs(d) < 0.0005 ? target : current + d * 0.14;
    render(current, true);
    if (current !== target && near) raf = requestAnimationFrame(loop);
  }
  function onScroll(): void {
    if (!dynamic) return;
    measure();
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function setMode(): void {
    dynamic = wide.matches && !reduced.matches;
    scroller.dataset.static = String(!dynamic);
    if (dynamic) { measure(); current = target; render(current, true); } else render(0, false);
  }

  new IntersectionObserver(([e]) => { near = e.isIntersecting; onScroll(); }, { rootMargin: '200px 0px' }).observe(scroller);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  wide.addEventListener('change', setMode);
  reduced.addEventListener('change', setMode);
  setMode();
}
