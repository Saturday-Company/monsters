/*
 * Monster invaders: the squad marches down in rows, you shoot from an orange key. Loaded only
 * when the arcade opens. Runs in 40ms frames like everything else; the kill switch pauses it.
 */
import { SPRITE_H, SPRITE_W, decodeFrame, type DecodedDot } from '../lib/sprites.ts';
import type { ClientData } from './main.ts';
import { isKilled } from './util.ts';

const W = 480;
const H = 360;
const FRAME_MS = 40;
const DOT = 2;
const COLS = 7;
const ROWS = 3;
const INV_W = SPRITE_W * DOT;
const INV_H = SPRITE_H * DOT;
const GAP_X = 56;
const GAP_Y = 40;
const PLAYER_W = 34;
const PLAYER_H = 12;
const SIGNAL = '#ff6a1f';
const INK = '#efe9dc';
const MUTED = '#8f8b81';

interface Invader {
  x: number;
  y: number;
  kind: number;
  alive: boolean;
}

interface Shot {
  x: number;
  y: number;
  v: number;
}

interface Burst {
  x: number;
  y: number;
  color: string;
  age: number;
}

type State = 'ready' | 'play' | 'over' | 'win';

export function createInvaders(dialog: HTMLDialogElement, data: ClientData) {
  const canvas = dialog.querySelector<HTMLCanvasElement>('[data-arcade-canvas]');
  const ctx = canvas?.getContext('2d');
  const t = data.t.invaders;
  // two frames per monster (eyes open, blink): the march alternates them
  const sprites: DecodedDot[][][] = data.invaders.map((s) => {
    const frames = s.frames['idle']?.cells ?? [];
    return frames.map((cells) => decodeFrame(s, cells));
  });

  let state: State = 'ready';
  let invaders: Invader[] = [];
  let dir = 1;
  let marchEvery = 14;
  let marchTick = 0;
  let marchFrame = 0;
  let px = W / 2;
  let shot: Shot | null = null;
  let bombs: Shot[] = [];
  let bursts: Burst[] = [];
  let score = 0;
  let lives = 3;
  let level = 1;
  const keys = { left: false, right: false, fire: false };
  let raf = 0;
  let last = 0;
  let running = false;

  const reset = (keepScore = false) => {
    invaders = [];
    const x0 = (W - (COLS - 1) * GAP_X - INV_W) / 2;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        invaders.push({
          x: x0 + c * GAP_X,
          y: 44 + r * GAP_Y,
          kind: c % sprites.length,
          alive: true,
        });
    dir = 1;
    marchEvery = Math.max(4, 14 - (level - 1) * 3);
    shot = null;
    bombs = [];
    bursts = [];
    if (!keepScore) {
      score = 0;
      lives = 3;
      level = 1;
    }
    px = W / 2;
  };

  const text = (
    s: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = 'center',
  ) => {
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.font = `900 ${size}px Doto, "Martian Mono", monospace`;
    ctx.textAlign = align;
    ctx.fillText(s.toUpperCase(), x, y);
  };

  const update = () => {
    if (state !== 'play') return;
    if (keys.left) px = Math.max(PLAYER_W / 2 + 4, px - 7);
    if (keys.right) px = Math.min(W - PLAYER_W / 2 - 4, px + 7);
    if (keys.fire && !shot) shot = { x: px, y: H - 34, v: -12 };

    // march
    if (++marchTick >= marchEvery) {
      marchTick = 0;
      marchFrame ^= 1;
      const alive = invaders.filter((i) => i.alive);
      const minX = Math.min(...alive.map((i) => i.x));
      const maxX = Math.max(...alive.map((i) => i.x + INV_W));
      if ((dir > 0 && maxX + 8 > W - 6) || (dir < 0 && minX - 8 < 6)) {
        dir = -dir;
        alive.forEach((i) => (i.y += 12));
      } else alive.forEach((i) => (i.x += dir * 8));
      // speed up as the squad thins out
      marchEvery = Math.max(
        2,
        Math.round((14 - (level - 1) * 3) * (alive.length / (COLS * ROWS))) + 1,
      );
      // a bomb from a random front-row monster
      if (alive.length && bombs.length < 2 + level && Math.random() < 0.55) {
        const shooter = alive[Math.floor(Math.random() * alive.length)];
        if (shooter) bombs.push({ x: shooter.x + INV_W / 2, y: shooter.y + INV_H, v: 4 + level });
      }
    }

    if (shot) {
      shot.y += shot.v;
      if (shot.y < 0) shot = null;
      else
        for (const inv of invaders) {
          if (!inv.alive) continue;
          if (
            shot.x > inv.x &&
            shot.x < inv.x + INV_W &&
            shot.y > inv.y &&
            shot.y < inv.y + INV_H
          ) {
            inv.alive = false;
            score += 10 * (ROWS - Math.floor((inv.y - 44) / GAP_Y) + 1);
            const color = data.invaders[inv.kind]?.colors[0] ?? INK;
            bursts.push({ x: inv.x + INV_W / 2, y: inv.y + INV_H / 2, color, age: 0 });
            shot = null;
            break;
          }
        }
    }

    bombs.forEach((b) => (b.y += b.v));
    bombs = bombs.filter((b) => {
      if (b.y > H) return false;
      if (b.y > H - 30 && b.y < H - 30 + PLAYER_H && Math.abs(b.x - px) < PLAYER_W / 2) {
        lives--;
        bursts.push({ x: px, y: H - 26, color: SIGNAL, age: 0 });
        if (lives <= 0) state = 'over';
        return false;
      }
      return true;
    });
    bursts.forEach((b) => b.age++);
    bursts = bursts.filter((b) => b.age < 8);

    const alive = invaders.filter((i) => i.alive);
    if (alive.length === 0) {
      level++;
      if (level > 3) state = 'win';
      else reset(true);
    } else if (alive.some((i) => i.y + INV_H >= H - 40)) state = 'over';
  };

  const draw = () => {
    if (!ctx) return;
    ctx.fillStyle = '#0d0d0c';
    ctx.fillRect(0, 0, W, H);
    // HUD
    text(`${t.score} ${String(score).padStart(4, '0')}`, 14, 26, 18, INK, 'left');
    text('♥'.repeat(Math.max(0, lives)), W - 14, 26, 18, SIGNAL, 'right');
    // ground
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(10, H - 14, W - 20, 1.5);

    for (const inv of invaders) {
      if (!inv.alive) continue;
      const frames = sprites[inv.kind] ?? [];
      const dots = frames[marchFrame % Math.max(1, frames.length)] ?? frames[0] ?? [];
      for (const d of dots) {
        ctx.fillStyle = d.color;
        ctx.fillRect(inv.x + d.x * DOT, inv.y + d.y * DOT, DOT - 0.2, DOT - 0.2);
      }
    }
    // the player: an orange key with its edge
    ctx.fillStyle = '#7a2600';
    ctx.fillRect(px - PLAYER_W / 2, H - 30 + 3, PLAYER_W, PLAYER_H);
    ctx.fillStyle = SIGNAL;
    ctx.fillRect(px - PLAYER_W / 2, H - 30, PLAYER_W, PLAYER_H);
    ctx.fillRect(px - 3, H - 37, 6, 7);

    ctx.fillStyle = INK;
    if (shot) ctx.fillRect(shot.x - 1.5, shot.y, 3, 9);
    ctx.fillStyle = '#ff5a4e';
    for (const b of bombs) {
      ctx.fillRect(b.x - 1.5, b.y, 3, 3);
      ctx.fillRect(b.x - 1.5 + (b.y % 6 < 3 ? 2 : -2), b.y + 4, 3, 3);
    }
    for (const b of bursts) {
      ctx.fillStyle = b.color;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const r = b.age * 3;
        ctx.fillRect(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r, 2.5, 2.5);
      }
    }

    if (state === 'ready') {
      text(t.title, W / 2, H / 2 - 4, 30, SIGNAL);
      text(t.start, W / 2, H / 2 + 28, 16, INK);
    } else if (state === 'over') {
      text(t.over, W / 2, H / 2, 34, '#ff5a4e');
      text(t.start, W / 2, H / 2 + 30, 14, MUTED);
    } else if (state === 'win') {
      text(t.win, W / 2, H / 2, 18, '#4fd98a');
      text(t.start, W / 2, H / 2 + 30, 14, MUTED);
    }
    if (isKilled()) {
      ctx.fillStyle = 'rgba(13,13,12,0.7)';
      ctx.fillRect(0, 0, W, H);
      text('STOP', W / 2, H / 2, 40, '#ff5a4e');
    }
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    last = now;
    if (!isKilled()) update();
    draw();
  };

  const press = (down: boolean) => (e: KeyboardEvent) => {
    const k = e.key;
    if ((e.target as HTMLElement | null)?.tagName === 'BUTTON' && (k === ' ' || k === 'Enter'))
      return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = down;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = down;
    else if (k === ' ' || k === 'ArrowUp' || k === 'Enter') {
      keys.fire = down;
      if (down && state !== 'play') {
        reset();
        state = 'play';
      }
    } else return;
    e.preventDefault();
  };
  const onDown = press(true);
  const onUp = press(false);

  dialog.querySelectorAll<HTMLButtonElement>('[data-pad]').forEach((b) => {
    const which = b.dataset['pad'] as 'left' | 'right' | 'fire';
    const set = (v: boolean) => () => {
      keys[which] = v;
      if (v && which === 'fire' && state !== 'play') {
        reset();
        state = 'play';
      }
    };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointerleave', set(false));
  });

  return {
    start() {
      if (running) return;
      running = true;
      state = 'ready';
      reset();
      dialog.addEventListener('keydown', onDown);
      dialog.addEventListener('keyup', onUp);
      raf = requestAnimationFrame(tick);
      if (canvas) {
        canvas.tabIndex = 0;
        canvas.focus();
      }
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      dialog.removeEventListener('keydown', onDown);
      dialog.removeEventListener('keyup', onUp);
      keys.left = keys.right = keys.fire = false;
    },
  };
}
