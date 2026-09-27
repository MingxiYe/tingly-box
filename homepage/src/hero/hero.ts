// Hero animation: agents and providers assemble into the Tingly Box "T".
//
// Growth starts from the Tingly Box icon. Walkers — requests — hop between free
// neighbouring cells of a T-shaped grid; every cell they land on flips in as an
// agent (left), IM channel (middle) or model provider (right). Once the T is
// complete it folds back into the Tingly Box icon, and assembly starts again
// from there with a different mix — for as long as the hero is on screen.
//
// Idea adapted from the recursive hero on anthropic.com/institute; the
// implementation here is independent.
import { AGENTS, CHANNELS, PROVIDERS } from '../data/brands';
import { CENTER, N, START, cells as shapeCells, col, neighbours, row, side } from './shape';
import { ctx2d, iconTile, loadSvg, makeCanvas, tTile, type Palette } from './tiles';

const TILE = 0.84;                  // tile edge as a fraction of the cell pitch
const SPAN = N - 1 + TILE;          // T edge measured in pitches
const TICK = 150;                   // ms per walker step
const POP = 460;                    // ms tile pop-in
const HOLD = 1100;                  // ms the finished T rests before folding
const FOLD = 900;                   // ms to fold the T back into the icon
const VARIANTS = 6;                 // icon shuffles, cycled round after round

const CAPTIONS = [
  'Any agent ⇄ any provider',
  'Shared keys, rules and usage for your team',
  'Guardrails, MCP tools and remote control',
];

interface Walker { idx: number; prev: number; since: number; bornAt: number; dieAt: number }
interface Round { variant: number; cells: Map<number, number>; walkers: Walker[]; lastTick: number; ticks: number; doneAt: number }

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function shuffled<T>(list: T[], r: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Icon per cell for each round: same structure (agents left, channels centre,
// providers right), a different shuffle each time.
const layouts: string[][] = Array.from({ length: VARIANTS }, (_, v) => {
  const r = rng(1000 + v * 97);
  const pools = {
    agent: shuffled(AGENTS.map((b) => b.icon), r),
    channel: shuffled(CHANNELS.map((b) => b.icon), r),
    provider: shuffled(PROVIDERS.map((b) => b.icon), r),
  };
  const used = { agent: 0, channel: 0, provider: 0 };
  const out: string[] = new Array(N * N);
  for (const i of shapeCells) {
    if (i === START) continue;
    const k = side(i);
    out[i] = pools[k][used[k]++ % pools[k].length];
  }
  return out;
});

/**
 * @param textColumn the hero copy; on wide screens the T is fitted into the
 *   space to its right so the two never overlap.
 */
export function startHero(canvas: HTMLCanvasElement, caption: HTMLElement | null, textColumn: HTMLElement | null): void {
  const ctx = ctx2d(canvas);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const icons = new Map<string, HTMLCanvasElement>();
  let brand = makeCanvas(1);
  let palette: Palette | null = null;
  let W = 0, H = 0, originX = 0, originY = 0, boxSize = 0;
  let dotColor = '#b9bcc4';
  let accent = '#2563eb';

  let round: Round = newRound(0, 0);
  const random = rng(0xc0ffee);
  let running = false, finished = false, raf = 0;

  function newRound(variant: number, now: number): Round {
    return {
      variant,
      cells: new Map([[START, now - POP * 2]]),
      walkers: [{ idx: START, prev: START, since: now, bornAt: now, dieAt: 0 }],
      lastTick: now, ticks: 0, doneAt: 0,
    };
  }

  function step(r: Round, now: number): void {
    // after a background tab or a pause, pick up where we were instead of catching up
    if (now - r.lastTick > 1000) r.lastTick = now - TICK;
    while (!r.doneAt && now - r.lastTick >= TICK) {
      r.lastTick += TICK;
      r.ticks++;
      const t = r.lastTick;
      const taken = new Set(r.walkers.filter((w) => !w.dieAt).map((w) => w.idx));
      const kept: Walker[] = [];
      for (const w of r.walkers) {
        if (w.dieAt) { if (t - w.dieAt < 300) kept.push(w); continue; }
        if (!r.cells.has(w.idx)) r.cells.set(w.idx, t);
        const options = (neighbours.get(w.idx) ?? []).filter((j) => !r.cells.has(j) && !taken.has(j));
        if (!options.length) { w.dieAt = t; kept.push(w); continue; }
        const next = options[(random() * options.length) | 0];
        w.prev = w.idx; w.idx = next; w.since = t;
        taken.add(next);
        kept.push(w);
      }
      r.walkers = kept;

      const alive = kept.filter((w) => !w.dieAt).length;
      const frontier: number[] = [];
      const seen = new Set<number>();
      for (const i of r.cells.keys()) {
        for (const j of neighbours.get(i) ?? []) {
          if (!r.cells.has(j) && !taken.has(j) && !seen.has(j)) { seen.add(j); frontier.push(j); }
        }
      }
      if (!frontier.length && !alive) { r.doneAt = t; break; }
      const target = Math.min(10, Math.max(1, Math.floor((r.ticks / 3) ** 2)));
      for (let n = alive; n < target && frontier.length; n++) {
        const k = (random() * frontier.length) | 0;
        const j = frontier[k];
        frontier[k] = frontier[frontier.length - 1];
        frontier.pop();
        r.walkers.push({ idx: j, prev: j, since: t, bornAt: t, dieAt: 0 });
      }
    }
  }

  function setCaption(i: number): void {
    if (caption && caption.dataset.round !== String(i)) {
      caption.dataset.round = String(i);
      caption.textContent = CAPTIONS[i % CAPTIONS.length];
    }
  }

  // ---------- drawing ----------
  function drawTile(img: CanvasImageSource, x: number, y: number, size: number, alpha: number): void {
    if (alpha <= 0.004 || size < 0.5) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  }

  /** Draws the grown cells of a T of edge `size` centred at (cx, cy). */
  function drawT(r: Round, cx: number, cy: number, size: number, now: number, alpha: number): void {
    const p = size / SPAN;
    for (const [i, bornAt] of r.cells) {
      const x = cx + (col(i) - CENTER) * p;
      const y = cy + (row(i) - CENTER) * p;
      let s = p * TILE;
      let a = alpha;
      const age = now - bornAt;
      if (age < POP) {
        const t = age / POP;
        s *= Math.max(0, 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2);
        a *= Math.min(1, age / 120);
      }
      const img = i === START ? brand : icons.get(layouts[r.variant][i]);
      if (img) drawTile(img, x, y, s, a);
    }
    ctx.globalAlpha = 1;
  }

  function dots(spacing: number, ox: number, oy: number, alpha: number): void {
    const sx = ((ox % spacing) + spacing) % spacing;
    const sy = ((oy % spacing) + spacing) % spacing;
    ctx.fillStyle = dotColor;
    ctx.globalAlpha = alpha;
    for (let y = sy; y <= H; y += spacing) for (let x = sx; x <= W; x += spacing) ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.globalAlpha = 1;
  }

  function draw(now: number): void {
    ctx.clearRect(0, 0, W, H);
    const p = boxSize / SPAN;
    dots(p, originX + p / 2, originY + p / 2, 0.5);

    // Where the start cell sits; the folded T lands exactly on it.
    const sx = originX + (col(START) - CENTER) * p;
    const sy = originY + (row(START) - CENTER) * p;
    const fold = round.doneAt && !finished ? clamp01((now - round.doneAt - HOLD) / FOLD) : 0;

    if (fold > 0) {
      // Shrink the whole T onto the start cell while it turns into the icon.
      const e = easeInOut(fold);
      const size = boxSize * ((p * TILE) / boxSize) ** e;
      const cx = originX + (sx - originX) * e;
      const cy = originY + (sy - originY) * e;
      const toIcon = clamp01((e - 0.35) / 0.55);
      drawT(round, cx, cy, size, now, 1 - toIcon);
      drawTile(brand, cx, cy, size, toIcon);
      ctx.globalAlpha = 1;
      return;
    }

    drawT(round, originX, originY, boxSize, now, 1);

    // walkers: small "requests" hopping between cells
    const radius = Math.max(2.5, Math.min(8, p * TILE * 0.12));
    ctx.fillStyle = accent;
    for (const w of round.walkers) {
      const life = w.dieAt
        ? (1 - Math.min(1, (now - w.dieAt) / 300)) ** 2
        : 1 - (1 - Math.min(1, (now - w.bornAt) / 300)) ** 3;
      if (life <= 0) continue;
      const e = 1 - (1 - Math.min(1, (now - w.since) / (TICK * 0.9))) ** 2;
      const ax = originX + (col(w.prev) - CENTER) * p, ay = originY + (row(w.prev) - CENTER) * p;
      const bx = originX + (col(w.idx) - CENTER) * p, by = originY + (row(w.idx) - CENTER) * p;
      const x = ax + (bx - ax) * e, y = ay + (by - ay) * e;
      ctx.globalAlpha = 0.18 * life;
      ctx.beginPath(); ctx.arc(x, y, radius * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = life;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- loop ----------
  function frame(now: number): void {
    if (!running) return;
    step(round, now);
    if (round.doneAt && now - round.doneAt > HOLD + FOLD) {
      round = newRound((round.variant + 1) % VARIANTS, now);
      setCaption(round.variant);
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  function resume(): void {
    cancelAnimationFrame(raf);
    running = true;
    raf = requestAnimationFrame(frame);
  }

  /** The finished T, without animation (reduced motion). */
  function showFinal(): void {
    round = newRound(0, -1e6);
    for (const i of shapeCells) round.cells.set(i, -1e6);
    round.walkers = [];
    round.doneAt = -1e6;
    finished = true;
    setCaption(0);
    draw(0);
  }

  function readPalette(): Palette {
    const css = getComputedStyle(canvas);
    const read = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
    dotColor = read('--hero-dot', '#b9bcc4');
    accent = read('--accent', '#2563eb');
    return { brandBg: read('--hero-brand-bg', '#1d1f24'), brandFg: read('--hero-brand-fg', '#ffffff') };
  }

  function layout(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const wide = W >= 960;
    if (wide) {
      // fit between the text column and the right edge, with breathing room
      let textRight = W * 0.45;
      if (textColumn) {
        const left = canvas.getBoundingClientRect().left;
        textRight = Math.max(...[...textColumn.children].map((c) => c.getBoundingClientRect().right)) - left;
      }
      const from = textRight + 64;
      const to = W - Math.max(48, (W - 1200) / 2);
      originX = (from + to) / 2;
      boxSize = Math.max(160, Math.min(to - from, H * 0.7));
    } else {
      originX = W * 0.5;
      boxSize = Math.min(W * 0.84, H * 0.84);
    }
    originY = H * 0.5;
    const next = readPalette();
    if (!palette || next.brandBg !== palette.brandBg || next.brandFg !== palette.brandFg) {
      palette = next;
      brand = tTile(next.brandBg, next.brandFg);
    }
    if (!running) draw(performance.now() + (finished ? 1e6 : 0));
  }

  // ---------- boot ----------
  const urls = [...new Set([...AGENTS, ...CHANNELS, ...PROVIDERS].map((b) => b.icon))];
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  Promise.all([fontsReady, ...urls.map(async (u) => icons.set(u, iconTile(await loadSvg(u))))]).then(() => {
    layout();
    new ResizeObserver(layout).observe(canvas);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', layout);

    if (reducedMotion) { showFinal(); return; }
    round = newRound(0, performance.now());
    setCaption(0);
    // loop while visible, pause (keeping the current frame) while scrolled away
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) resume();
      else { running = false; cancelAnimationFrame(raf); }
    }, { threshold: 0.15 }).observe(canvas);
  });
}
