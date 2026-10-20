import { DOT_OFF } from '@monsters/monster-kit';
import { SPEED, type Column } from './god.ts';

/*
 * The dot marquee of the god's bar (D-101), on a canvas and outside React:
 * one turn of the columns is painted once into a tile, and each step draws
 * that tile shifted by one column. It moves by steps (a display, never a
 * glide), at most `SPEED.max` steps a second, and only while the page is
 * visible and the canvas is on screen; still is still (no timer at all).
 */

/** Distance between two dots, in CSS px. */
export const PITCH = 5;
/** Radius of a dot, as a share of the pitch: LEDs fill 80% of it. */
const RADIUS = 0.4;

export interface MarqueeModel {
  columns: readonly Column[];
  /** Columns per second; 0 is still. */
  speed: number;
  /** All the lights at half (the monsters are stopped). */
  dimmed: boolean;
}

export class Marquee {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private tile: HTMLCanvasElement | null = null;
  private tileCols = 0;
  private model: MarqueeModel = { columns: [], speed: 0, dimmed: false };
  /** "Riduci movimento": a still arrangement of the colours. */
  private still = false;
  private offset = 0;
  private dpr = 1;
  private cssWidth = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private raf: number | null = null;
  private onScreen = true;
  private readonly resize: ResizeObserver | null;
  private readonly seen: IntersectionObserver | null;
  private readonly onVisibility = () => this.schedule();
  /** Steps drawn so far: read by the tests and the performance check. */
  frames = 0;

  constructor(canvas: HTMLCanvasElement, rows: number) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.style.height = `${rows * PITCH}px`;
    this.resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width ?? 0;
            if (Math.round(w) !== this.cssWidth) this.layout(w, rows);
          });
    this.resize?.observe(canvas);
    this.seen =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            this.onScreen = entries.at(-1)?.isIntersecting ?? true;
            this.schedule();
          });
    this.seen?.observe(canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.layout(canvas.getBoundingClientRect().width, rows);
  }

  set(model: MarqueeModel, still: boolean): void {
    const repaint = model.columns !== this.model.columns || model.dimmed !== this.model.dimmed;
    this.model = model;
    this.still = still;
    if (still) this.offset = 0;
    if (repaint) this.paintTile();
    this.draw();
    this.schedule();
  }

  destroy(): void {
    this.stop();
    this.resize?.disconnect();
    this.seen?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** One column in device pixels, a whole number: the dots never smear between steps. */
  private get step(): number {
    return Math.max(1, Math.round(PITCH * this.dpr));
  }

  private layout(width: number, rows: number): void {
    this.cssWidth = Math.round(width);
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * this.dpr));
    this.canvas.height = rows * this.step;
    this.paintTile();
    this.draw();
  }

  /** One turn of the marquee, every dot painted once (the off ones too). */
  private paintTile(): void {
    const cols = this.model.columns;
    this.tileCols = cols.length;
    if (cols.length === 0) {
      this.tile = null;
      return;
    }
    const rows = cols[0]!.length;
    const tile = this.tile ?? document.createElement('canvas');
    const step = this.step;
    tile.width = cols.length * step;
    tile.height = rows * step;
    const g = tile.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, tile.width, tile.height);
    const r = RADIUS * step;
    // One path per colour, like the kit's SVG: a handful of fills for the whole turn.
    const byColor = new Map<string, [number, number][]>();
    cols.forEach((col, x) =>
      col.forEach((c, y) => {
        const key = c ?? DOT_OFF;
        if (!byColor.has(key)) byColor.set(key, []);
        byColor.get(key)!.push([x, y]);
      }),
    );
    for (const [color, cells] of byColor) {
      const lit = color !== DOT_OFF;
      g.globalAlpha = lit && this.model.dimmed ? 0.45 : 1;
      g.fillStyle = color;
      g.beginPath();
      for (const [x, y] of cells) {
        const cx = x * step + step / 2;
        const cy = y * step + step / 2;
        g.moveTo(cx + r, cy);
        g.arc(cx, cy, r, 0, Math.PI * 2);
      }
      g.fill();
    }
    g.globalAlpha = 1;
    this.tile = tile;
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const tile = this.tile;
    if (!tile || this.tileCols === 0) return;
    const step = this.step;
    const tileW = tile.width;
    let x = -((this.offset % this.tileCols) * step);
    while (x < this.canvas.width) {
      ctx.drawImage(tile, x, 0);
      x += tileW;
    }
    this.frames++;
  }

  private running(): boolean {
    return (
      !this.still &&
      this.model.speed > 0 &&
      this.tileCols > 0 &&
      this.onScreen &&
      document.visibilityState !== 'hidden'
    );
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.timer = null;
    this.raf = null;
  }

  /** The next step, or none: a timer per step (no loop at 60 Hz), drawn in the next frame. */
  private schedule(): void {
    this.stop();
    if (!this.running()) return;
    const interval = 1000 / Math.min(SPEED.max, this.model.speed);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.offset = (this.offset + 1) % Math.max(1, this.tileCols);
        this.draw();
        this.schedule();
      });
    }, interval);
  }
}
