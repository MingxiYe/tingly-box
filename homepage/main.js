(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- logo lists ----------
  const AGENTS = [
    ['claudecode-color', 'Claude Code'], ['claude-color', 'Claude Desktop'], ['codex-color', 'Codex'],
    ['opencode', 'OpenCode'], ['cursor', 'Cursor'], ['xcode', 'Xcode'], ['vscode', 'VS Code'],
    ['pi', 'Pi'], ['openclaw-color', 'OpenClaw'], ['cherrystudio-color', 'Cherry Studio'],
    ['openai', 'OpenAI SDK'], ['anthropic', 'Anthropic SDK'],
  ];
  const PROVIDERS = [
    ['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['gemini-color', 'Gemini'], ['deepseek-color', 'DeepSeek'],
    ['qwen-color', 'Qwen'], ['kimi', 'Kimi'], ['zhipu-color', 'Zhipu'], ['minimax-color', 'MiniMax'],
    ['xai', 'xAI'], ['mistral-color', 'Mistral'], ['openrouter-color', 'OpenRouter'], ['groq', 'Groq'],
    ['doubao-color', 'Doubao'], ['bedrock-color', 'Bedrock'], ['azure-color', 'Azure'], ['vertexai-color', 'Vertex AI'],
    ['nvidia-color', 'NVIDIA'], ['siliconcloud-color', 'SiliconFlow'], ['stepfun-color', 'StepFun'],
    ['fireworks-color', 'Fireworks'], ['together-color', 'Together'], ['ollama', 'Ollama'], ['vllm-color', 'vLLM'],
    ['lmstudio', 'LM Studio'],
  ];
  const IM = [
    ['telegram', 'Telegram'], ['slack', 'Slack'], ['discord', 'Discord'], ['feishu', 'Feishu / Lark'],
    ['dingtalk', 'DingTalk'], ['wecom', 'WeCom'], ['weixin', 'Weixin'],
  ];

  function fillLogos(id, list, withLabel = true) {
    const ul = document.getElementById(id);
    if (!ul) return;
    for (const [icon, label] of list) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = `icons/${icon}.svg`;
      img.alt = withLabel ? '' : label;
      img.title = label;
      img.loading = 'lazy';
      li.append(img);
      if (withLabel) li.append(label);
      ul.append(li);
    }
  }
  fillLogos('logos-agents', AGENTS);
  fillLogos('logos-providers', PROVIDERS);
  fillLogos('logos-im', IM, false);

  // ---------- copy buttons ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    const host = btn.closest('[data-copy]');
    const text = host ? host.dataset.copy : btn.parentElement.querySelector('pre code')?.textContent;
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text.trim()).then(() => {
      btn.dataset.copied = '';
      btn.textContent = 'Copied';
      setTimeout(() => { delete btn.dataset.copied; btn.textContent = 'Copy'; }, 1600);
    });
  });

  // ---------- tabs ----------
  for (const root of document.querySelectorAll('[data-tabs]')) {
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
      });
    });
  }

  // ---------- reveal on scroll ----------
  const revealTargets = document.querySelectorAll('.section-head, .feature, .shot, .team-steps li, .logo-row, .doc-links a, .strip-inner > div');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    for (const el of revealTargets) { el.classList.add('reveal'); io.observe(el); }
  }

  // ---------- "How it works" stage ----------
  const svg = document.getElementById('flow-svg');
  const scroller = document.querySelector('.flow-scroll');
  if (!svg || !scroller) return;

  const NS = 'http://www.w3.org/2000/svg';
  const items = [];                  // {el, step, order, kind}
  function el(tag, attrs, parent = svg) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.append(n);
    return n;
  }
  function group(step, order, kind = 'pop', origin) {
    const g = el('g', {});
    items.push({ el: g, step, order, kind, origin });
    return g;
  }
  function iconCard(parent, x, y, icon, size = 40) {
    el('rect', { x: x - size / 2, y: y - size / 2, width: size, height: size, rx: size * 0.26, fill: '#fff', stroke: 'rgba(22,24,29,0.14)' }, parent);
    el('image', { href: `icons/${icon}.svg`, x: x - size * 0.29, y: y - size * 0.29, width: size * 0.58, height: size * 0.58 }, parent);
  }
  function edge(step, order, d) {
    const g = group(step, order, 'edge');
    el('path', { d, class: 'fl-edge', pathLength: 1 }, g);
    el('path', { d, class: 'fl-flow', pathLength: 1 }, g);
    return g;
  }

  const BOX = { x: 500, y: 330, s: 136 };

  // step 0 — agents
  const agents = [['claudecode-color', 'Claude Code'], ['codex-color', 'Codex'], ['opencode', 'OpenCode'], ['cursor', 'Cursor'], ['xcode', 'Xcode']];
  const agentY = (i) => 206 + i * 62;
  // edges first so they sit under the cards
  agents.forEach((_, i) => edge(1, i, `M 236 ${agentY(i)} C 330 ${agentY(i)}, 340 ${BOX.y}, ${BOX.x - BOX.s / 2 - 6} ${BOX.y}`));
  const providers = [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['gemini-color', 'Gemini'], ['deepseek-color', 'DeepSeek'], ['qwen-color', 'Qwen'], ['ollama', 'Ollama']];
  const provY = (i) => 188 + i * 56;
  providers.forEach((_, i) => edge(2, i, `M ${BOX.x + BOX.s / 2 + 6} ${BOX.y} C 670 ${BOX.y}, 690 ${provY(i)}, 776 ${provY(i)}`));
  const members = ['AL', 'BK', 'CS', 'DM'];
  const memberX = (i) => 380 + i * 80;
  members.forEach((_, i) => edge(3, i, `M ${memberX(i)} 126 C ${memberX(i)} 170, 500 160, 500 ${BOX.y - BOX.s / 2 - 40}`));
  [330, 500, 670].forEach((x, i) => edge(4, i, `M 500 ${BOX.y + BOX.s / 2 + 64} C 500 520, ${x} 510, ${x} 540`));

  agents.forEach(([icon, label], i) => {
    const g = group(0, i, 'pop', [110, agentY(i)]);
    iconCard(g, 110, agentY(i), icon);
    el('text', { x: 142, y: agentY(i) + 5, class: 'fl-label' }, g).textContent = label;
  });

  // step 1 — the box and its endpoint
  {
    const g = group(1, 0, 'pop', [BOX.x, BOX.y]);
    el('rect', { x: BOX.x - BOX.s / 2, y: BOX.y - BOX.s / 2, width: BOX.s, height: BOX.s, rx: BOX.s * 0.28, class: 'fl-brand' }, g);
    const t = el('text', { x: BOX.x, y: BOX.y + 24, 'text-anchor': 'middle', fill: '#fff', style: 'font: 700 68px Inter, system-ui, sans-serif' }, g);
    t.textContent = 'T';
    const e = group(1, 2, 'pop', [BOX.x, BOX.y - BOX.s / 2 - 27]);
    el('rect', { x: BOX.x - 118, y: BOX.y - BOX.s / 2 - 40, width: 236, height: 26, rx: 13, class: 'fl-accent-soft' }, e);
    el('text', { x: BOX.x, y: BOX.y - BOX.s / 2 - 23, 'text-anchor': 'middle', class: 'fl-accent-text' }, e).textContent = 'localhost:12580/tingly/…';
  }

  // step 2 — providers + routing rule
  providers.forEach(([icon, label], i) => {
    const g = group(2, i + 1, 'pop', [800, provY(i)]);
    iconCard(g, 800, provY(i), icon, 36);
    el('text', { x: 828, y: provY(i) + 5, class: 'fl-label' }, g).textContent = label;
  });
  {
    const g = group(2, 0, 'pop', [BOX.x, BOX.y + BOX.s / 2 + 38]);
    el('rect', { x: BOX.x - 150, y: BOX.y + BOX.s / 2 + 14, width: 300, height: 48, rx: 12, class: 'fl-card' }, g);
    el('text', { x: BOX.x - 134, y: BOX.y + BOX.s / 2 + 34, class: 'fl-mono' }, g).textContent = 'rule  claude-sonnet';
    el('text', { x: BOX.x - 134, y: BOX.y + BOX.s / 2 + 52, class: 'fl-label' }, g).textContent = '→ Anthropic · fallback DeepSeek';
    const p = group(2, 3, 'pop', [745, 149]);
    el('rect', { x: 660, y: 136, width: 170, height: 26, rx: 13, class: 'fl-soft' }, p);
    el('text', { x: 745, y: 153, 'text-anchor': 'middle', class: 'fl-mono' }, p).textContent = 'Anthropic ⇄ OpenAI ⇄ Gemini';
  }

  // step 3 — team members with sharing keys
  members.forEach((initials, i) => {
    const x = memberX(i);
    const g = group(3, i, 'pop', [x, 96]);
    el('circle', { cx: x, cy: 88, r: 22, class: 'fl-soft' }, g);
    el('text', { x, y: 93, 'text-anchor': 'middle', class: 'fl-title' }, g).textContent = initials;
    el('rect', { x: x - 30, y: 114, width: 60, height: 18, rx: 9, class: 'fl-card' }, g);
    el('text', { x, y: 127, 'text-anchor': 'middle', class: 'fl-mono', style: 'font-size:10px' }, g).textContent = `sk-••${i + 3}f`;
  });
  {
    const g = group(3, 5, 'pop', [220, 88]);
    el('text', { x: 300, y: 80, 'text-anchor': 'end', class: 'fl-title' }, g).textContent = 'Your team';
    el('text', { x: 300, y: 98, 'text-anchor': 'end', class: 'fl-mono' }, g).textContent = 'one key each';
  }

  // step 4 — govern & observe
  {
    const g = group(4, 0, 'pop', [330, 575]);
    el('rect', { x: 250, y: 544, width: 160, height: 62, rx: 12, class: 'fl-card' }, g);
    el('path', { d: 'M 274 558 l 12 -4 l 12 4 v 9 c 0 8 -6 13 -12 15 c -6 -2 -12 -7 -12 -15 z', class: 'fl-accent' }, g);
    el('text', { x: 308, y: 569, class: 'fl-title' }, g).textContent = 'Guardrails';
    el('text', { x: 308, y: 588, class: 'fl-mono', style: 'font-size:10px' }, g).textContent = 'keys masked';
  }
  {
    const g = group(4, 1, 'pop', [500, 575]);
    el('rect', { x: 420, y: 544, width: 160, height: 62, rx: 12, class: 'fl-card' }, g);
    el('text', { x: 436, y: 566, class: 'fl-title' }, g).textContent = 'Usage';
    [14, 22, 12, 28, 20, 32, 24].forEach((h, i) => {
      el('rect', { x: 436 + i * 18, y: 596 - h * 0.6, width: 10, height: h * 0.6, rx: 2, class: i === 5 ? 'fl-accent' : 'fl-soft' }, g);
    });
  }
  {
    const g = group(4, 2, 'pop', [670, 575]);
    el('rect', { x: 590, y: 544, width: 160, height: 62, rx: 12, class: 'fl-card' }, g);
    el('text', { x: 606, y: 566, class: 'fl-title' }, g).textContent = 'Remote';
    ['telegram', 'slack', 'feishu', 'dingtalk'].forEach((icon, i) => iconCard(g, 618 + i * 30, 588, icon, 24));
  }

  // camera stops for each step (x, y, w, h)
  const CAMERA = [
    [-20, 140, 560, 358],
    [30, 120, 660, 422],
    [40, 110, 920, 520],
    [30, 30, 940, 560],
    [0, 20, 1000, 620],
  ];
  const FULL = [0, 20, 1000, 620];
  const steps = [...document.querySelectorAll('.flow-step')];

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const backOut = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
  const STEP_GAP = 0.9, STEP_ANIM = 0.7;

  function render(t, dynamic) {
    // reveal of each step, 0..1
    const r = [0, 1, 2, 3, 4].map((k) => (dynamic ? clamp((t - k * STEP_GAP) / STEP_ANIM) : 1));
    for (const it of items) {
      const local = dynamic ? clamp((r[it.step] * STEP_ANIM - it.order * 0.05) / (STEP_ANIM * 0.55)) : 1;
      if (it.kind === 'edge') {
        it.el.style.opacity = local > 0 ? 1 : 0;
        it.el.firstChild.style.strokeDashoffset = String(1 - local);
        it.el.lastChild.style.opacity = local >= 1 ? 1 : 0;
      } else {
        const s = local <= 0 ? 0 : backOut(local);
        it.el.style.opacity = String(Math.min(1, local * 2));
        const [ox, oy] = it.origin;
        it.el.setAttribute('transform', `translate(${ox} ${oy}) scale(${s}) translate(${-ox} ${-oy})`);
      }
    }
    let box = FULL;
    if (dynamic) {
      const c = r.slice(1).reduce((a, v) => a + ease(v), 0);
      const i = Math.min(CAMERA.length - 2, Math.floor(c));
      const f = c - i;
      box = CAMERA[i].map((v, j) => v + (CAMERA[i + 1][j] - v) * f);
    }
    svg.setAttribute('viewBox', box.map((v) => v.toFixed(2)).join(' '));

    let active = 0;
    for (let k = 0; k < 5; k++) if (t >= k * STEP_GAP) active = k;
    steps.forEach((s, k) => {
      s.dataset.state = !dynamic ? 'static' : k === active ? 'active' : k < active ? 'done' : 'upcoming';
    });
  }

  const wide = window.matchMedia('(min-width: 992px)');
  let dynamic = false, target = 0, current = 0, raf = 0, near = false;

  function measure() {
    const rect = scroller.getBoundingClientRect();
    const span = rect.height - window.innerHeight;
    const p = span > 0 ? clamp(-rect.top / span) : 1;
    target = 0.5 + p * (4 * STEP_GAP + STEP_ANIM - 0.3);
  }
  function loop() {
    raf = 0;
    const d = target - current;
    current = Math.abs(d) < 0.0005 ? target : current + d * 0.14;
    render(current, true);
    if (current !== target && near) raf = requestAnimationFrame(loop);
  }
  function onScroll() {
    if (!dynamic) return;
    measure();
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function setMode() {
    dynamic = wide.matches && !reducedMotion.matches;
    scroller.dataset.static = String(!dynamic);
    if (dynamic) { measure(); current = target; render(current, true); } else render(0, false);
  }

  new IntersectionObserver(([e]) => { near = e.isIntersecting; onScroll(); }, { rootMargin: '200px 0px' }).observe(scroller);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  wide.addEventListener('change', setMode);
  reducedMotion.addEventListener('change', setMode);
  setMode();
})();
