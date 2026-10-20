/*
 * Titan on the hero screen, as 255 LED dots that are real particles. The cursor pushes them
 * away, a click (or Enter) blows them apart and they spring back home with a new expression.
 * The grids are Titan's own (painted by the kit at build time). Motion is frame-stepped like
 * the app: physics and drawing advance in 40ms frames. Reduced motion draws still frames; the
 * kill switch puts Titan to sleep and stops the loop.
 */
import { SPRITE_H, SPRITE_W, type Sprite } from '../lib/sprites.ts';
import { isKilled, onKill, reducedMotion } from './util.ts';

type Step = readonly [frame: number, ms: number];

const FRAME_MS = 40;
const N = SPRITE_W * SPRITE_H;
/** Expressions a poke cycles through; idle comes back after a while. */
const CYCLE = ['think', 'happy', 'talk', 'confused'];
const BACK_TO_IDLE = 3400;
const OFF = 'rgba(255,255,255,0.07)';

export function initHero(sprite: Sprite, timelines: Record<string, readonly Step[]>): void {
  const stage = document.querySelector<HTMLElement>('[data-titan]');
  if (!stage) return;
  const hudExpr = document.querySelector('[data-titan-expr]');
  const hudLit = document.querySelector('[data-titan-lit]');

  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', stage.dataset['label'] ?? 'Titan');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  stage.replaceChildren(canvas);

  // particle state, one per grid cell
  const hx = new Float32Array(N);
  const hy = new Float32Array(N);
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  let pitch = 10;
  let dpr = 1;

  const layout = () => {
    const w = stage.clientWidth || 300;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    pitch = w / SPRITE_W;
    const h = pitch * SPRITE_H;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    for (let i = 0; i < N; i++) {
      const x = ((i % SPRITE_W) + 0.5) * pitch;
      const y = (Math.floor(i / SPRITE_W) + 0.5) * pitch;
      const dx = px[i]! - hx[i]!;
      const dy = py[i]! - hy[i]!;
      hx[i] = x;
      hy[i] = y;
      px[i] = x + (Number.isFinite(dx) ? dx : 0);
      py[i] = y + (Number.isFinite(dy) ? dy : 0);
    }
  };
  for (let i = 0; i < N; i++) {
    px[i] = 0;
    py[i] = 0;
  }
  layout();
  for (let i = 0; i < N; i++) {
    px[i] = hx[i]!;
    py[i] = hy[i]!;
  }

  // expression and its frame loop
  let expr = 'idle';
  let loopStart = performance.now();
  let backTimer: ReturnType<typeof setTimeout> | null = null;
  let pokes = 0;
  const reduce = reducedMotion();

  const frameOf = (now: number): number => {
    const steps = timelines[expr === 'idle' ? 'idle-a' : expr] ?? [[0, 1000]];
    const total = steps.reduce((s, [, ms]) => s + ms, 0);
    if (reduce || total === 0) return 0;
    let t = (now - loopStart) % total;
    for (const [f, ms] of steps) {
      if (t < ms) return f;
      t -= ms;
    }
    return 0;
  };

  const setExpr = (next: string) => {
    if (!sprite.frames[next]) return;
    expr = next;
    loopStart = performance.now();
    if (hudExpr) hudExpr.textContent = next.toUpperCase();
  };

  // pointer, in canvas pixels (CSS px)
  let mx = -1e4;
  let my = -1e4;
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
    wake();
  });
  canvas.addEventListener('pointerleave', () => {
    mx = -1e4;
    my = -1e4;
  });

  const poke = (cx: number, cy: number) => {
    if (isKilled()) return;
    setExpr(CYCLE[pokes % CYCLE.length] ?? 'happy');
    pokes++;
    if (!reduce) {
      for (let i = 0; i < N; i++) {
        const dx = hx[i]! - cx;
        const dy = hy[i]! - cy;
        const d = Math.hypot(dx, dy) || 1;
        const kick = pitch * (1.6 + Math.random() * 2.4);
        vx[i] = (dx / d) * kick + (Math.random() - 0.5) * pitch;
        vy[i] = (dy / d) * kick + (Math.random() - 0.5) * pitch;
      }
    }
    if (backTimer) clearTimeout(backTimer);
    backTimer = setTimeout(() => {
      if (!isKilled()) setExpr('idle');
      wake();
    }, BACK_TO_IDLE);
    wake();
  };
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    poke(e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      poke((SPRITE_W * pitch) / 2, (SPRITE_H * pitch) / 2);
    }
  });

  // physics: spring home, damping, repulsion from the pointer
  const stepPhysics = (): boolean => {
    let moving = false;
    const R = pitch * 3;
    for (let i = 0; i < N; i++) {
      let ax = (hx[i]! - px[i]!) * 0.14;
      let ay = (hy[i]! - py[i]!) * 0.14;
      const dx = px[i]! - mx;
      const dy = py[i]! - my;
      const d = Math.hypot(dx, dy);
      if (d < R && d > 0.01) {
        const f = (1 - d / R) * pitch * 0.9;
        ax += (dx / d) * f;
        ay += (dy / d) * f;
      }
      vx[i] = (vx[i]! + ax) * 0.72;
      vy[i] = (vy[i]! + ay) * 0.72;
      px[i] = px[i]! + vx[i]!;
      py[i] = py[i]! + vy[i]!;
      if (!moving && (Math.abs(vx[i]!) > 0.05 || Math.abs(px[i]! - hx[i]!) > 0.3)) moving = true;
    }
    return moving;
  };

  let lastLit = -1;
  const draw = (now: number) => {
    const data = sprite.frames[expr] ?? sprite.frames['idle'];
    if (!data) return;
    const f = frameOf(now);
    const cells = data.cells[f] ?? data.cells[0] ?? '';
    const light = data.light[f] ?? 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const r = pitch * 0.46;
    ctx.fillStyle = OFF;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      ctx.moveTo(hx[i]! + r, hy[i]!);
      ctx.arc(hx[i]!, hy[i]!, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = light;
    let lit = 0;
    // one path per colour
    for (let c = 0; c < sprite.colors.length; c++) {
      const ch = String(c);
      ctx.fillStyle = sprite.colors[c] ?? '#fff';
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (cells.charAt(i) !== ch) continue;
        lit++;
        ctx.moveTo(px[i]! + r, py[i]!);
        ctx.arc(px[i]!, py[i]!, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (hudLit && lit !== lastLit) {
      hudLit.textContent = String(lit).padStart(3, '0');
      lastLit = lit;
    }
  };

  // the loop: runs only while visible, not killed, and something moves or animates
  let raf = 0;
  let last = 0;
  let visible = true;
  const tick = (now: number) => {
    raf = 0;
    if (!visible || isKilled()) return;
    if (now - last >= FRAME_MS) {
      last = now;
      if (!reduce) stepPhysics();
      draw(now);
    }
    if (!reduce) raf = requestAnimationFrame(tick);
  };
  function wake() {
    if (reduce) {
      draw(performance.now());
      return;
    }
    if (!raf && visible && !isKilled()) raf = requestAnimationFrame(tick);
  }

  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) wake();
  }).observe(canvas);

  new ResizeObserver(() => {
    layout();
    draw(performance.now());
  }).observe(stage);

  onKill((killed) => {
    if (killed) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (backTimer) clearTimeout(backTimer);
      for (let i = 0; i < N; i++) {
        px[i] = hx[i]!;
        py[i] = hy[i]!;
        vx[i] = 0;
        vy[i] = 0;
      }
      setExpr('sleep');
      loopStart = performance.now();
      draw(loopStart);
    } else {
      setExpr('idle');
      wake();
    }
  });

  setExpr('idle');
  draw(performance.now());
  wake();
}
