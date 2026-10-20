/**
 * Blinks and glances as short Web Animations, started now and then by one timer for the whole
 * page, instead of the infinite CSS animations of `monsterCss`.
 *
 * Why: an SVG part animated by CSS is computed on the main thread at every frame for as long as
 * the animation runs, holds included (style, SVG layout of the group and repaint of the monster).
 * Blinking and looking around hold still most of the time but were more than half of the animated
 * parts on a page (two or three lids and pupils per monster). Run as one-shot animations they cost
 * nothing between one blink and the next.
 *
 * The host marks an ancestor with `data-eye-life` (then `monsterCss` leaves the lids and the idle
 * pupils alone) and calls `startEyeLife`. Without it the CSS animations keep working as before.
 * Talking, thinking and the error tremble keep their CSS animations on the pupils.
 */

/** Attribute on an ancestor (e.g. `<html>`) that hands the eyes over to `startEyeLife`. */
export const EYE_LIFE_ATTR = 'data-eye-life';

/** The part of a DOM element the driver uses (the kit does not depend on the DOM types). */
export interface EyePart {
  getAttribute(name: string): string | null;
  readonly style: { transform: string };
  animate(
    keyframes: { transform: string }[],
    options: { duration: number; easing: string },
  ): { cancel(): void };
}

export interface MonsterSvg {
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): Iterable<EyePart>;
}

export interface EyeRoot {
  querySelectorAll(selector: string): Iterable<MonsterSvg>;
}

export interface EyeLifeOptions {
  /** Between 0 and 1 (default `Math.random`). */
  random?: () => number;
  /** True while the eyes should rest (reduced motion, hidden page): pupils back to the centre. */
  still?: () => boolean;
  /** Milliseconds between two checks (default 150): the timing of a blink is not that precise. */
  tickMs?: number;
  /**
   * Which monsters to animate (default every `svg[data-monster]`): a host can leave out the
   * ones it knows are off screen, e.g. `.monster:not([data-offscreen]) svg[data-monster]`.
   */
  selector?: string;
}

/** Expressions whose pupils look around (the others animate them in CSS, or keep them still). */
const LOOKING = new Set(['idle', 'happy']);

/** Where the pupils are: centre, left, right and a little up (as the CSS `m-look` did). */
type Gaze = 0 | 1 | 2;

interface EyeState {
  /** Tempo of the personality: 0.7 (quick) to 1.3 (slow), as `--m-k` in `monsterCss`. */
  k: number;
  nextBlink: number;
  /** The second blink of a double blink is due. */
  double: boolean;
  nextLook: number;
  gaze: Gaze;
  /** The glance of each pupil, cancelled if the next one starts before its end. */
  glances: { cancel(): void }[];
}

const BLINK_MS = 210;
const DOUBLE_GAP_MS = 350;
const GLANCE_MS = 600;

function tempo(svg: MonsterSvg): number {
  const speed = /--m-speed:\s*([\d.]+)/.exec(svg.getAttribute('style') ?? '')?.[1];
  const s = speed === undefined ? 0.5 : Number(speed);
  return 1.3 - 0.6 * (Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0.5);
}

function lookOf(pupil: EyePart): number {
  const v = /--m-look:\s*([\d.]+)px/.exec(pupil.getAttribute('style') ?? '')?.[1];
  const n = v === undefined ? 2 : Number(v);
  return Number.isFinite(n) ? n : 2;
}

function gazeTransform(gaze: Gaze, look: number): string {
  if (gaze === 1) return `translate(${-look}px, 0px)`;
  if (gaze === 2) return `translate(${look}px, ${(-0.35 * look).toFixed(2)}px)`;
  return 'translate(0px, 0px)';
}

export class EyeLife {
  readonly #root: EyeRoot;
  readonly #random: () => number;
  readonly #still: () => boolean;
  readonly #tickMs: number;
  readonly #selector: string;
  readonly #states = new WeakMap<MonsterSvg, EyeState>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: EyeRoot, opts: EyeLifeOptions = {}) {
    this.#root = root;
    this.#random = opts.random ?? Math.random;
    this.#still = opts.still ?? (() => false);
    this.#tickMs = opts.tickMs ?? 150;
    this.#selector = opts.selector ?? 'svg[data-monster]';
  }

  start(): void {
    if (this.#timer) return;
    const loop = () => {
      this.tick(performance.now());
      this.#timer = setTimeout(loop, this.#tickMs);
    };
    this.#timer = setTimeout(loop, this.#tickMs);
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Starts the blinks and glances that are due at `now` (milliseconds). */
  tick(now: number): void {
    const still = this.#still();
    for (const svg of this.#root.querySelectorAll(this.#selector)) {
      let s = this.#states.get(svg);
      if (!s) {
        const k = tempo(svg);
        // spread out, so that the monsters of a page never blink together
        s = {
          k,
          nextBlink: now + this.#random() * 4000 * k,
          double: false,
          nextLook: now + (1500 + this.#random() * 4000) * k,
          gaze: 0,
          glances: [],
        };
        this.#states.set(svg, s);
      }
      if (still) {
        if (s.gaze !== 0) this.#rest(svg, s);
        // when they wake up, not all at the same moment
        if (s.nextBlink <= now) s.nextBlink = now + this.#random() * 4000 * s.k;
        if (s.nextLook <= now) s.nextLook = now + this.#random() * 4000 * s.k;
        continue;
      }
      if (now >= s.nextBlink) this.#blink(svg, s, now);
      if (now >= s.nextLook) {
        if (LOOKING.has(svg.getAttribute('data-expression') ?? '')) this.#glance(svg, s, now);
        else {
          if (s.gaze !== 0) this.#rest(svg, s);
          s.nextLook = now + 2000 * s.k;
        }
      }
    }
  }

  #blink(svg: MonsterSvg, s: EyeState, now: number): void {
    for (const lid of svg.querySelectorAll('.m-lid')) {
      lid.animate(
        [{ transform: 'scale(1, 0)' }, { transform: 'scale(1, 1)' }, { transform: 'scale(1, 0)' }],
        { duration: BLINK_MS * s.k, easing: 'linear' },
      );
    }
    if (!s.double && this.#random() < 0.3) {
      s.double = true;
      s.nextBlink = now + DOUBLE_GAP_MS * s.k;
    } else {
      s.double = false;
      s.nextBlink = now + (2000 + this.#random() * 3500) * s.k;
    }
  }

  #glance(svg: MonsterSvg, s: EyeState, now: number): void {
    const r = this.#random();
    const to: Gaze = s.gaze === 0 ? (r < 0.5 ? 1 : 2) : r < 0.6 ? 0 : s.gaze === 1 ? 2 : 1;
    for (const g of s.glances) g.cancel();
    s.glances = [];
    for (const pupil of svg.querySelectorAll('.m-pupil')) {
      const look = lookOf(pupil);
      const target = gazeTransform(to, look);
      // The pupil stays there through its inline style, not a `fill: forwards`:
      // Chrome keeps recomputing a filled animation at every frame.
      pupil.style.transform = to === 0 ? '' : target;
      s.glances.push(
        pupil.animate([{ transform: gazeTransform(s.gaze, look) }, { transform: target }], {
          duration: GLANCE_MS * s.k,
          easing: 'ease-in-out',
        }),
      );
    }
    s.gaze = to;
    s.nextLook =
      now + (to === 0 ? 2500 + this.#random() * 3000 : 1200 + this.#random() * 1400) * s.k;
  }

  /** Pupils back to the centre at once. */
  #rest(svg: MonsterSvg, s: EyeState): void {
    for (const g of s.glances) g.cancel();
    s.glances = [];
    for (const pupil of svg.querySelectorAll('.m-pupil')) pupil.style.transform = '';
    s.gaze = 0;
  }
}

/** Starts the eyes of every monster under `root`; returns the function that stops them. */
export function startEyeLife(root: EyeRoot, opts: EyeLifeOptions = {}): () => void {
  const life = new EyeLife(root, opts);
  life.start();
  return () => life.stop();
}
