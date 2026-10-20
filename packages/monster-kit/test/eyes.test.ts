import { describe, expect, it } from 'vitest';
import { EYE_LIFE_ATTR, EyeLife, monsterCss, type EyePart, type MonsterSvg } from '../src/index.ts';

/*
 * Blinks and glances as short Web Animations (eyes.ts), checked on fake
 * elements: what is animated, when, and that nothing runs for ever.
 */

interface Call {
  keyframes: { transform: string }[];
  duration: number;
  cancelled: boolean;
}

class FakePart implements EyePart {
  readonly calls: Call[] = [];
  readonly style = { transform: '' };
  readonly #attrs: Record<string, string>;
  constructor(attrs: Record<string, string> = {}) {
    this.#attrs = attrs;
  }
  getAttribute(name: string): string | null {
    return this.#attrs[name] ?? null;
  }
  animate(keyframes: { transform: string }[], options: { duration: number }) {
    const call: Call = { keyframes, duration: options.duration, cancelled: false };
    this.calls.push(call);
    return { cancel: () => void (call.cancelled = true) };
  }
}

class FakeSvg implements MonsterSvg {
  readonly lids = [new FakePart(), new FakePart()];
  readonly pupils = [
    new FakePart({ style: '--m-look:3px' }),
    new FakePart({ style: '--m-look:3px' }),
  ];
  readonly expression: string;
  readonly #speed: number;
  constructor(expression = 'idle', speed = 0.5) {
    this.expression = expression;
    this.#speed = speed;
  }
  getAttribute(name: string): string | null {
    if (name === 'data-expression') return this.expression;
    if (name === 'style')
      return `--m-bounce:0.50;--m-speed:${this.#speed.toFixed(2)};--m-phase:-1s`;
    return null;
  }
  querySelectorAll(selector: string): EyePart[] {
    return selector === '.m-lid' ? this.lids : selector === '.m-pupil' ? this.pupils : [];
  }
}

function setup(svgs: FakeSvg[], still = () => false) {
  let seed = 1;
  // small deterministic generator
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const life = new EyeLife({ querySelectorAll: () => svgs }, { random, still });
  const run = (fromMs: number, toMs: number) => {
    for (let t = fromMs; t <= toMs; t += 100) life.tick(t);
  };
  return { life, run };
}

describe('eye life', () => {
  it('blinks every lid now and then with a short animation', () => {
    const svg = new FakeSvg();
    const { run } = setup([svg]);
    run(0, 60_000);
    const blinks = svg.lids[0]!.calls;
    // about one blink every 2 to 5.5 s (some double), like the CSS cycle did
    expect(blinks.length).toBeGreaterThan(10);
    expect(blinks.length).toBeLessThan(40);
    expect(svg.lids[1]!.calls).toHaveLength(blinks.length);
    for (const b of blinks) {
      expect(b.keyframes.map((k) => k.transform)).toEqual([
        'scale(1, 0)',
        'scale(1, 1)',
        'scale(1, 0)',
      ]);
      expect(b.duration).toBeLessThan(300);
    }
  });

  it('a quick personality blinks faster', () => {
    const quick = new FakeSvg('idle', 1);
    const slow = new FakeSvg('idle', 0);
    const { run } = setup([quick, slow]);
    run(0, 120_000);
    expect(quick.lids[0]!.calls.length).toBeGreaterThan(slow.lids[0]!.calls.length);
    expect(quick.lids[0]!.calls[0]!.duration).toBeLessThan(slow.lids[0]!.calls[0]!.duration);
  });

  it('glances from where the pupils are, and keeps them there with the inline style', () => {
    const svg = new FakeSvg();
    const { run } = setup([svg]);
    run(0, 30_000);
    const glances = svg.pupils[0]!.calls;
    expect(glances.length).toBeGreaterThan(3);
    for (let i = 1; i < glances.length; i++) {
      // each glance starts where the previous one ended: no jump
      expect(glances[i]!.keyframes[0]).toEqual(glances[i - 1]!.keyframes[1]);
    }
    const last = glances.at(-1)!.keyframes[1]!.transform;
    expect(svg.pupils[0]!.style.transform).toBe(last === 'translate(0px, 0px)' ? '' : last);
    expect(glances.map((g) => g.keyframes[1]!.transform)).toContain('translate(-3px, 0px)');
    expect(glances.map((g) => g.keyframes[1]!.transform)).toContain('translate(3px, -1.05px)');
  });

  it('leaves the pupils to the CSS while talking, thinking or in error', () => {
    const svg = new FakeSvg('talk');
    const { run } = setup([svg]);
    run(0, 30_000);
    expect(svg.pupils[0]!.calls).toHaveLength(0);
    expect(svg.lids[0]!.calls.length).toBeGreaterThan(0);
  });

  it('rests with reduced motion: pupils back to the centre, no blinks', () => {
    const svg = new FakeSvg();
    let still = false;
    const { run } = setup([svg], () => still);
    run(0, 30_000);
    // stop right after a glance away from the centre
    const away = svg.pupils[0]!.calls.length;
    expect(away).toBeGreaterThan(0);
    still = true;
    const blinks = svg.lids[0]!.calls.length;
    run(30_100, 60_000);
    expect(svg.lids[0]!.calls).toHaveLength(blinks);
    expect(svg.pupils[0]!.calls).toHaveLength(away);
    expect(svg.pupils[0]!.style.transform).toBe('');
  });

  it('the CSS hands lids and idle pupils over when the host sets the attribute', () => {
    expect(monsterCss).toContain(`[${EYE_LIFE_ATTR}] svg[data-monster] .m-lid`);
    expect(monsterCss).toContain(
      `[${EYE_LIFE_ATTR}] svg[data-monster][data-expression="idle"] .m-pupil`,
    );
    // without it the CSS animations stay
    expect(monsterCss).toMatch(/svg\[data-monster\] \.m-lid \{\n {2}animation: m-blink/);
  });

  it('animates only the monsters the selector picks (the host leaves out the hidden ones)', () => {
    const shown = new FakeSvg();
    const hidden = new FakeSvg();
    const asked: string[] = [];
    const root = {
      querySelectorAll: (sel: string) => {
        asked.push(sel);
        return sel === 'svg[data-monster]' ? [shown, hidden] : [shown];
      },
    };
    const life = new EyeLife(root, {
      selector: '.monster:not([data-offscreen]) svg[data-monster]',
    });
    for (let t = 0; t <= 20_000; t += 100) life.tick(t);
    expect(asked.every((s) => s.startsWith('.monster:not'))).toBe(true);
    expect(shown.lids[0]!.calls.length).toBeGreaterThan(0);
    expect(hidden.lids[0]!.calls).toHaveLength(0);
  });
});
