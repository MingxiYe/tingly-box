// Hero animation: "one box → one team → every team".
//
// A 9×9 rounded grid grows outward from the Tingly Box tile. Walkers (requests)
// hop between free neighbouring cells; every cell they land on flips in as an
// agent (left half), IM channel (middle column) or model provider (right half).
// Once a box is full the camera zooms out and the finished box becomes a single
// tile of the next, bigger grid — a team of boxes — and the growth starts again.
//
// Idea adapted from the recursive "spark" hero on anthropic.com/institute; the
// implementation here is independent.
(() => {
  'use strict';

  const canvas = document.getElementById('hero-canvas');
  const caption = document.getElementById('hero-level');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- grid geometry ----------
  const N = 9;
  const C = (N - 1) / 2;
  const CENTER = C * N + C;
  const TILE = 0.84;                  // tile edge as a fraction of the cell pitch
  const SPAN = N - 1 + TILE;          // box edge measured in pitches
  const ZOOM = SPAN / TILE;           // a full box becomes one tile of the next level
  const MAX_LEVEL = 2;                // 0: box · 1: team · 2: every team
  const TICK = 150;                   // ms per walker step
  const POP = 460;                    // ms tile pop-in
  const TEX = 512;                    // px of a cached complete-box texture

  const LEVEL_CAPTIONS = [
    'One box · any agent ⇄ any provider',
    'One team · shared keys, rules and usage',
    'Every team · one governed AI gateway',
  ];

  const inMask = new Uint8Array(N * N);
  const maskCells = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const corner = (x === 0 || x === N - 1) && (y === 0 || y === N - 1);
      if (!corner) { inMask[y * N + x] = 1; maskCells.push(y * N + x); }
    }
  }
  const neighbours = new Map();
  for (const i of maskCells) {
    const x = i % N, y = (i / N) | 0, out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < N && ny < N && inMask[ny * N + nx]) out.push(ny * N + nx);
    }
    neighbours.set(i, out);
  }

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (a, b) => (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) >>> 0;

  // ---------- icons ----------
  const AGENTS = ['claudecode-color', 'claude-color', 'codex-color', 'opencode', 'pi', 'cursor',
    'xcode', 'vscode', 'githubcopilot', 'openclaw-color', 'cherrystudio-color', 'openai', 'anthropic'];
  const CHANNELS = ['telegram', 'slack', 'discord', 'feishu', 'dingtalk', 'wecom', 'weixin'];
  const PROVIDERS = ['anthropic', 'openai', 'gemini-color', 'deepseek-color', 'qwen-color', 'kimi',
    'zhipu-color', 'minimax-color', 'xai', 'mistral-color', 'openrouter-color', 'groq', 'doubao-color',
    'bedrock-color', 'azure-color', 'vertexai-color', 'nvidia-color', 'perplexity-color',
    'siliconcloud-color', 'stepfun-color', 'ollama', 'vllm-color', 'lmstudio', 'cohere-color',
    'fireworks-color', 'together-color', 'modelscope-color', 'xiaomimimo', 'cerebras-color', 'hunyuan-color'];

  const tiles = new Map();            // icon name -> pre-rendered tile canvas

  function makeCanvas(w, h = w) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }

  function renderIconTile(img) {
    const S = 160, c = makeCanvas(S), g = c.getContext('2d');
    roundRect(g, 2, 2, S - 4, S - 4, S * 0.24);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(20, 24, 33, 0.10)';
    g.stroke();
    if (img) {
      const s = S * 0.54;
      g.drawImage(img, (S - s) / 2, (S - s) / 2, s, s);
    }
    return c;
  }

  // Theme-dependent colours, read from CSS custom properties in layout().
  let palette = {
    brandBg: '#1d1f24', brandFg: '#ffffff',
    solids: ['#1d1f24', '#2a2e37', '#2563eb', '#383d48', '#4f7cf0', '#23262d'],
  };

  function renderBrandTile() {
    const S = 160, c = makeCanvas(S), g = c.getContext('2d');
    roundRect(g, 2, 2, S - 4, S - 4, S * 0.3);
    g.fillStyle = palette.brandBg;
    g.fill();
    g.fillStyle = palette.brandFg;
    g.font = `700 ${S * 0.5}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('T', S / 2, S / 2 + S * 0.03);
    return c;
  }

  function loadIcon(name) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `icons/${name}.svg`;
    }).then((img) => { tiles.set(name, renderIconTile(img)); });
  }

  // ---------- which icon sits where ----------
  // Level-0 variants: each shuffles its three pools, so boxes in a team look alike
  // in structure (agents left, channels centre, providers right) but not identical.
  const L0_VARIANTS = 6;
  const L1_VARIANTS = 4;

  function shuffled(list, r) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const iconLayout = Array.from({ length: L0_VARIANTS }, (_, v) => {
    const r = rng(1000 + v * 97);
    const pools = { a: shuffled(AGENTS, r), c: shuffled(CHANNELS, r), p: shuffled(PROVIDERS, r) };
    const used = { a: 0, c: 0, p: 0 };
    const out = new Array(N * N);
    for (const i of maskCells) {
      if (i === CENTER) { out[i] = 'brand'; continue; }
      const x = i % N;
      const k = x < C ? 'a' : x > C ? 'p' : 'c';
      out[i] = pools[k][used[k]++ % pools[k].length];
    }
    return out;
  });

  // Variant of the level-(L-1) box placed in cell i of a level-L box of variant v.
  function childVariant(L, v, i) {
    if (i === CENTER) return 0;
    return hash(v + L * 31, i) % (L - 1 === 0 ? L0_VARIANTS : L1_VARIANTS);
  }

  // A finished box seen from far away collapses into one solid tile, mostly ink
  // like the Tingly logo with some brand blue — the mosaic a team turns into.
  let solids = [];
  const renderSolids = () => palette.solids.map((color) => {
    const S = 64, c = makeCanvas(S), g = c.getContext('2d');
    roundRect(g, 1, 1, S - 2, S - 2, S * 0.26);
    g.fillStyle = color;
    g.fill();
    const hi = g.createLinearGradient(0, 0, 0, S);
    hi.addColorStop(0, 'rgba(255,255,255,0.14)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hi;
    g.fill();
    return c;
  });

  // ---------- drawing ----------
  let W = 0, H = 0, DPR = 1, originX = 0, originY = 0, boxSize = 0;
  const textures = [];                // textures[v] -> mip chain of a complete level-0 box

  function mipChain(src) {
    const chain = [src];
    let cur = src;
    while (cur.width > 24) {
      const next = makeCanvas(Math.max(12, cur.width >> 1));
      const g = next.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(cur, 0, 0, next.width, next.height);
      chain.push(next);
      cur = next;
    }
    return chain;
  }

  function pickMip(chain, px) {
    for (let i = chain.length - 1; i >= 0; i--) if (chain[i].width >= px) return chain[i];
    return chain[0];
  }

  const cellPos = (i, cx, cy, pitch) => [cx + (i % N - C) * pitch, cy + (((i / N) | 0) - C) * pitch];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function visible(x, y, s) {
    return x + s / 2 > 0 && y + s / 2 > 0 && x - s / 2 < W && y - s / 2 < H;
  }

  function blit(g, img, x, y, size, alpha) {
    if (alpha <= 0.004) return;
    g.globalAlpha = alpha;
    g.drawImage(img, x - size / 2, y - size / 2, size, size);
  }

  // A complete level-L box as one unit: detailed while its inner tiles are big
  // enough to read, a solid tile once they are not, cross-fading in between.
  function drawUnit(g, L, v, x, y, size, alpha, onScreen) {
    if (onScreen && !visible(x, y, size)) return;
    const inner = size / SPAN * TILE;
    const [lo, hi] = L === 0 ? [5, 10] : [1.2, 2.4];
    const detail = clamp01((inner - lo) / (hi - lo));
    if (detail < 1) blit(g, solids[L === 0 ? v % solids.length : 0], x, y, size * 0.94, alpha * (1 - detail));
    if (detail <= 0) return;
    const px = size * (onScreen ? DPR : 1);
    if (L === 0 && textures[v] && px <= TEX * 0.9) blit(g, pickMip(textures[v], px), x, y, size, alpha * detail);
    else drawBox(g, L, v, x, y, size, null, 0, onScreen, alpha * detail);
  }

  // One cell of a level-L box: an icon tile on level 0, otherwise a whole
  // level-(L-1) box.
  function drawCell(g, L, variant, i, x, y, size, onScreen, alpha) {
    if (onScreen && !visible(x, y, size)) return;
    if (L === 0) {
      const tile = tiles.get(iconLayout[variant][i]);
      if (tile) blit(g, tile, x, y, size, alpha);
      return;
    }
    drawUnit(g, L - 1, childVariant(L, variant, i), x, y, size, alpha, onScreen);
  }

  // A level-L box of the given edge size centred at (cx, cy). With `cells`
  // (idx -> bornAt) only those cells are drawn, popping in by age.
  function drawBox(g, L, variant, cx, cy, size, cells, now, onScreen, alpha = 1) {
    const pitch = size / SPAN;
    const tileSize = pitch * TILE;
    if (tileSize < 0.6) return;
    const list = cells ? cells.keys() : maskCells;
    for (const i of list) {
      const [x, y] = cellPos(i, cx, cy, pitch);
      let s = tileSize, a = alpha;
      if (cells) {
        const age = now - cells.get(i);
        if (age < POP) {
          const t = age / POP;
          const back = 1.70158;
          s *= Math.max(0, 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2);
          a *= Math.min(1, age / 120);
        }
      }
      if (s > 0.3) drawCell(g, L, variant, i, x, y, s, onScreen, a);
    }
    g.globalAlpha = 1;
  }

  function buildTextures() {
    for (let v = 0; v < L0_VARIANTS; v++) {
      const c = makeCanvas(TEX), g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      drawBox(g, 0, v, TEX / 2, TEX / 2, TEX, null, 0, false);
      textures[v] = mipChain(c);
    }
  }

  function dots(spacing, cx, cy, alpha) {
    if (spacing < 6 || alpha < 0.01) return;
    const ox = ((cx % spacing) + spacing) % spacing;
    const oy = ((cy % spacing) + spacing) % spacing;
    ctx.fillStyle = dotColor;
    ctx.globalAlpha = alpha;
    for (let y = oy; y <= H; y += spacing) {
      for (let x = ox; x <= W; x += spacing) ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- growth ----------
  let level = 0;
  let state = null;
  let cam = 0, camVel = 0;            // cam: log-zoom in units of one level
  let running = false, raf = 0, lastFrame = 0, finished = false;
  let random = rng(0xc0ffee);
  let dotColor = '#b9bcc4';
  let accentColor = '#2563eb';

  function newLevel(now, L) {
    const cells = new Map([[CENTER, now - POP * 2]]);
    return { L, cells, walkers: [{ idx: CENTER, prev: CENTER, since: now, bornAt: now, dieAt: 0 }],
      lastTick: now, ticks: 0, doneAt: 0 };
  }

  function step(st, now) {
    while (!st.doneAt && now - st.lastTick >= TICK) {
      st.lastTick += TICK;
      st.ticks++;
      const t = st.lastTick;
      const taken = new Set(st.walkers.filter((w) => !w.dieAt).map((w) => w.idx));
      const kept = [];
      for (const w of st.walkers) {
        if (w.dieAt) { if (t - w.dieAt < 300) kept.push(w); continue; }
        if (!st.cells.has(w.idx)) st.cells.set(w.idx, t);
        const options = neighbours.get(w.idx).filter((j) => !st.cells.has(j) && !taken.has(j));
        if (!options.length) { w.dieAt = t; kept.push(w); continue; }
        const next = options[(random() * options.length) | 0];
        w.prev = w.idx; w.idx = next; w.since = t;
        taken.add(next);
        kept.push(w);
      }
      st.walkers = kept;

      const alive = kept.filter((w) => !w.dieAt).length;
      const frontier = [];
      const seen = new Set();
      for (const i of st.cells.keys()) {
        for (const j of neighbours.get(i)) {
          if (!st.cells.has(j) && !taken.has(j) && !seen.has(j)) { seen.add(j); frontier.push(j); }
        }
      }
      if (!frontier.length && !alive) { st.doneAt = t; break; }
      const target = Math.min(18, Math.max(1, Math.floor((st.ticks / 3) ** 2)));
      for (let n = alive; n < target && frontier.length; n++) {
        const k = (random() * frontier.length) | 0;
        const j = frontier[k];
        frontier[k] = frontier[frontier.length - 1];
        frontier.pop();
        st.walkers.push({ idx: j, prev: j, since: t, bornAt: t, dieAt: 0 });
      }
    }
  }

  function camTarget() {
    const frac = state.cells.size / maskCells.length;
    if (state.doneAt && level < MAX_LEVEL) return level + 0.15;
    return level - 0.32 * (1 - frac) ** 1.3;
  }

  function setCaption(L) {
    if (caption && caption.dataset.level !== String(L)) {
      caption.dataset.level = String(L);
      caption.textContent = LEVEL_CAPTIONS[L];
    }
  }

  // ---------- frame ----------
  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    const size = boxSize * ZOOM ** (level - cam);
    const pitch = size / SPAN;
    dots(pitch, originX + pitch / 2, originY + pitch / 2, 0.55 * Math.min(1, (pitch - 6) / 20));
    dots(pitch / ZOOM * TILE, originX, originY, 0.35 * Math.min(1, (pitch / ZOOM - 8) / 30));

    drawBox(ctx, level, 0, originX, originY, size, state.cells, now, true);

    // walkers: small "requests" hopping between cells
    const tileSize = pitch * TILE;
    const r = Math.max(2.5, Math.min(9, tileSize * 0.12));
    ctx.fillStyle = accentColor;
    for (const w of state.walkers) {
      const life = w.dieAt
        ? (1 - Math.min(1, (now - w.dieAt) / 300)) ** 2
        : 1 - (1 - Math.min(1, (now - w.bornAt) / 300)) ** 3;
      if (life <= 0) continue;
      const k = Math.min(1, (now - w.since) / (TICK * 0.9));
      const e = 1 - (1 - k) ** 2;
      const [ax, ay] = cellPos(w.prev, originX, originY, pitch);
      const [bx, by] = cellPos(w.idx, originX, originY, pitch);
      const x = ax + (bx - ax) * e, y = ay + (by - ay) * e;
      ctx.globalAlpha = 0.18 * life;
      ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = life;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    step(state, now);
    if (state.doneAt && level < MAX_LEVEL && now - state.doneAt > 450) {
      level++;
      state = newLevel(now, level);
      setCaption(level);
    }

    // critically damped spring toward the target zoom
    const k = 14;
    camVel += (k * k * (camTarget() - cam) - 2 * k * camVel) * dt;
    cam += camVel * dt;

    draw(now);

    if (level === MAX_LEVEL && state.doneAt && now - state.doneAt > 1800 && Math.abs(camVel) < 1e-4) {
      running = false;
      finished = true;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    const now = performance.now();
    level = 0;
    random = rng(0xc0ffee);
    state = newLevel(now, 0);
    cam = camTarget();
    camVel = 0;
    finished = false;
    setCaption(0);
    running = true;
    lastFrame = now;
    raf = requestAnimationFrame(frame);
  }

  function showStatic() {
    level = 0;
    state = newLevel(-1e6, 0);
    for (const i of maskCells) state.cells.set(i, -1e6);
    state.walkers = [];
    state.doneAt = -1e6;
    cam = 0;
    setCaption(0);
    draw(0);
  }

  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const wide = W >= 960;
    originX = wide ? W * 0.72 : W * 0.5;
    originY = H * 0.5;
    boxSize = wide ? Math.min(W * 0.4, H * 0.72) : Math.min(W * 0.82, H * 0.82);
    const css = getComputedStyle(canvas);
    const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    dotColor = read('--hero-dot', '#b9bcc4');
    accentColor = read('--accent', '#2563eb');
    const next = {
      brandBg: read('--hero-brand-bg', '#1d1f24'),
      brandFg: read('--hero-brand-fg', '#ffffff'),
      solids: read('--hero-solids', palette.solids.join(',')).split(',').map((s) => s.trim()),
    };
    if (JSON.stringify(next) !== JSON.stringify(palette) || !solids.length) {
      palette = next;
      tiles.set('brand', renderBrandTile());
      solids = renderSolids();
      buildTextures();
    }
    if (state && !running) draw(finished || reducedMotion ? performance.now() + 1e6 : performance.now());
  }

  // ---------- boot ----------
  const names = new Set([...AGENTS, ...CHANNELS, ...PROVIDERS]);
  // layout() renders the brand tile, solids and textures once fonts and icons are in
  const ready = (document.fonts ? document.fonts.ready : Promise.resolve())
    .then(() => Promise.all([...names].map(loadIcon)));

  ready.then(() => {
    layout();
    new ResizeObserver(layout).observe(canvas);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', layout);
    new MutationObserver(layout).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    if (reducedMotion) { showStatic(); return; }
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (!running && (!state || finished)) start();
      } else if (running) {
        running = false;
        cancelAnimationFrame(raf);
        finished = true;           // replay from the start when scrolled back
      }
    }, { threshold: 0.15 }).observe(canvas);

    const replay = document.getElementById('hero-replay');
    if (replay) replay.addEventListener('click', () => { cancelAnimationFrame(raf); running = false; start(); });
  });
})();
